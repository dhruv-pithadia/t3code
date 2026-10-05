import {
  FeatureTaskError,
  type FeatureTaskDelivery as FeatureTaskDeliveryModel,
  type FeatureTaskId,
} from "@yantrix/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as GitManager from "../git/GitManager.ts";
import * as PullRequests from "../pullRequest/PullRequestService.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";

export class FeatureTaskDeliveryService extends Context.Service<
  FeatureTaskDeliveryService,
  {
    readonly get: (input: {
      readonly id: FeatureTaskId;
    }) => Effect.Effect<FeatureTaskDeliveryModel, FeatureTaskError>;
  }
>()("yantrix/featureTasks/FeatureTaskDeliveryService") {}

const unknownDelivery = (updatedAt: string | null): FeatureTaskDeliveryModel => ({
  pullRequest: null,
  checks: "unknown",
  mergeState: "unknown",
  updatedAt,
});

function pullRequestRepository(
  input: string,
): { readonly host: string; readonly repository: string } | null {
  try {
    const url = new URL(input);
    const repository = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/gu, "");
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.host || !repository)
      return null;
    return { host: url.host.toLowerCase(), repository };
  } catch {
    return null;
  }
}

const isFeatureTaskError = Schema.is(FeatureTaskError);

export const layer = Layer.effect(
  FeatureTaskDeliveryService,
  Effect.gen(function* () {
    const tasks = yield* FeatureTasks.FeatureTaskService;
    const git = yield* GitManager.GitManager;
    const pullRequests = yield* PullRequests.PullRequestService;

    const get: FeatureTaskDeliveryService["Service"]["get"] = Effect.fn(
      "FeatureTaskDeliveryService.get",
    )(function* ({ id }) {
      const { task } = yield* tasks.get({ id }).pipe(
        Effect.catchIf(
          (cause) => !isFeatureTaskError(cause),
          () =>
            Effect.fail(
              new FeatureTaskError({
                code: "storage",
                message: "Feature task delivery could not be read.",
                taskId: id,
              }),
            ),
        ),
      );
      const binding = task.workspace;
      if (!binding) return unknownDelivery(null);

      // The project checkout is present even when this task's worktree folder is missing.
      // GitManager resolves the saved branch from that checkout without reading its files.
      const branchPullRequest = yield* Effect.result(
        git.branchPullRequest({ cwd: binding.repoPath, branch: binding.branch }, { refresh: true }),
      );
      if (branchPullRequest._tag === "Failure") {
        yield* Effect.logWarning("Feature task delivery refresh failed", {
          taskId: id,
          cause: branchPullRequest.failure,
        });
        return unknownDelivery(null);
      }
      const observedAt = DateTime.formatIso(DateTime.toUtc(yield* DateTime.now));
      const pr = branchPullRequest.success;
      if (pr === null) return unknownDelivery(observedAt);

      const repository = pullRequestRepository(pr.repositoryKey ?? "");
      const branchFacts = {
        pullRequest: {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          headBranch: pr.headRef,
          baseBranch: pr.baseRef,
        },
        checks: "unknown" as const,
        mergeState: pr.state,
        updatedAt: observedAt,
      } satisfies FeatureTaskDeliveryModel;
      if (repository === null) return branchFacts;

      const reference = {
        projectId: task.projectId,
        host: repository.host,
        repository: repository.repository,
        number: pr.number,
      };
      // Delivery is presented as a current check, so strand any ordinary UI
      // cache entry before asking for a summary. A strict read also bypasses
      // PullRequestService's held last-good summary fallback.
      yield* pullRequests.invalidate({ reference });
      const summaryResult = yield* Effect.result(
        pullRequests.summary(
          { ...reference, allowStale: false },
          { recoverTransientFailure: false },
        ),
      );
      if (summaryResult._tag === "Failure") {
        yield* Effect.logWarning("Feature task pull request summary refresh failed", {
          taskId: id,
          number: pr.number,
          cause: summaryResult.failure,
        });
        return branchFacts;
      }
      const summary = summaryResult.success;
      const samePullRequest =
        summary.number === pr.number && summary.headBranch === pr.headRef && summary.url === pr.url;
      if (!samePullRequest) return branchFacts;

      return {
        pullRequest: {
          number: summary.number,
          title: summary.title,
          url: summary.url,
          state: summary.state,
          headBranch: summary.headBranch,
          baseBranch: summary.baseBranch,
        },
        checks: summary.checksState ?? "unknown",
        mergeState: summary.state,
        updatedAt: observedAt,
      } satisfies FeatureTaskDeliveryModel;
    });

    return FeatureTaskDeliveryService.of({ get });
  }),
);
