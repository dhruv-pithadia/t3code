import * as NodeCrypto from "node:crypto";
import {
  FeatureTaskError,
  type FeatureTask,
  type FeatureTaskDependencyCheck,
} from "@yantrix/contracts";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@yantrix/shared/git";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";

const Repository = Schema.Struct({
  defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
});
const PullRequests = Schema.Array(
  Schema.Struct({
    number: Schema.Number,
    url: Schema.String,
    state: Schema.String,
    headRefName: Schema.String,
    baseRefName: Schema.String,
    isCrossRepository: Schema.Boolean,
    mergeCommit: Schema.NullOr(Schema.Struct({ oid: Schema.String })),
  }),
);

const decodeRepository = Schema.decodeEffect(Schema.fromJsonString(Repository));
const decodePullRequests = Schema.decodeEffect(Schema.fromJsonString(PullRequests));

export class FeatureTaskDependencyService extends Context.Service<
  FeatureTaskDependencyService,
  {
    readonly check: (input: {
      readonly task: FeatureTask;
      readonly repoPath: string;
      readonly worktreePath?: string;
    }) => Effect.Effect<
      {
        readonly dependencies: ReadonlyArray<FeatureTaskDependencyCheck>;
        readonly baseCommit: string | null;
        readonly baseBranch: string | null;
      },
      FeatureTaskError
    >;
  }
>()("yantrix/featureTasks/FeatureTaskDependencyService") {}

const make = Effect.gen(function* () {
  const tasks = yield* FeatureTasks.FeatureTaskService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const github = yield* GitHubCli.GitHubCli;
  const check: FeatureTaskDependencyService["Service"]["check"] = Effect.fn(
    "FeatureTaskDependencyService.check",
  )(function* ({ task, repoPath, worktreePath }) {
    const ids = task.dependencyIds ?? [];
    if (ids.length === 0) return { dependencies: [], baseCommit: null, baseBranch: null };
    const prerequisites = yield* Effect.forEach(ids, (id) =>
      tasks.get({ id }).pipe(Effect.map(({ task }) => task)),
    );
    const unknown = (message: string) => ({
      dependencies: prerequisites.map((item) => ({
        id: item.id,
        title: item.title,
        state: "unknown" as const,
        message,
        pullRequestUrl: null,
      })),
      baseCommit: null,
      baseBranch: null,
    });
    if (prerequisites.some((item) => item.projectId !== task.projectId))
      return unknown("A prerequisite is outside this project. Edit the task prerequisites.");
    return yield* Effect.gen(function* () {
      const remote = yield* git.execute({
        operation: "dependencies.remote",
        cwd: repoPath,
        args: ["config", "--get", "remote.origin.url"],
      });
      const repository = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remote.stdout.trim());
      if (!repository) return unknown("Dependency verification requires a GitHub origin remote.");
      const repo = yield* github.execute({
        cwd: repoPath,
        args: ["repo", "view", `github.com/${repository}`, "--json", "defaultBranchRef"],
      });
      const decoded = yield* decodeRepository(repo.stdout);
      const baseBranch = decoded.defaultBranchRef?.name;
      if (!baseBranch) return unknown("The repository has no default branch yet.");
      // Validate the host-provided ref before it is used as a Git argument or refspec.
      yield* git.execute({
        operation: "dependencies.validateRef",
        cwd: repoPath,
        args: ["check-ref-format", `refs/heads/${baseBranch}`],
      });
      const observations = yield* Effect.forEach(prerequisites, (item) =>
        Effect.gen(function* () {
          const base = { id: item.id, title: item.title, pullRequestUrl: null };
          if (!item.workspace)
            return {
              ...base,
              state: "waiting" as const,
              message: "Waiting for this task to open and merge a pull request.",
              commit: null,
            };
          const output = yield* github.execute({
            cwd: repoPath,
            args: [
              "pr",
              "list",
              "--repo",
              `github.com/${repository}`,
              "--head",
              item.workspace.branch,
              "--state",
              "all",
              "--limit",
              "2",
              "--json",
              "number,url,state,headRefName,baseRefName,isCrossRepository,mergeCommit",
            ],
          });
          const prs = yield* decodePullRequests(output.stdout);
          if (
            prs.length !== 1 ||
            prs[0]!.isCrossRepository ||
            prs[0]!.headRefName !== item.workspace.branch
          )
            return {
              ...base,
              state: "unknown" as const,
              message: "A unique pull request for this task could not be verified.",
              commit: null,
            };
          const pr = prs[0]!;
          if (pr.state !== "MERGED")
            return {
              ...base,
              pullRequestUrl: pr.url,
              state: "waiting" as const,
              message:
                pr.state === "CLOSED"
                  ? "Pull request closed without merging. Reopen it or change the prerequisite."
                  : "Waiting for this pull request to merge.",
              commit: null,
            };
          if (
            pr.baseRefName !== baseBranch ||
            !pr.mergeCommit ||
            !/^[a-f0-9]{40,64}$/u.test(pr.mergeCommit.oid)
          )
            return {
              ...base,
              pullRequestUrl: pr.url,
              state: "unknown" as const,
              message: "Merge into the current default branch could not be verified.",
              commit: null,
            };
          return {
            ...base,
            pullRequestUrl: pr.url,
            state: "merged" as const,
            message: "Merge verified on GitHub.",
            commit: pr.mergeCommit.oid,
          };
        }),
      );
      if (observations.some((item) => item.state !== "merged"))
        return { dependencies: observations, baseCommit: null, baseBranch: null };
      // Fetch the explicit URL we inspected, so a changed remote cannot select a different repository.
      const temporaryRef = `refs/yantrix/dependency-checks/${NodeCrypto.randomUUID()}`;
      const baseCommit = yield* Effect.gen(function* () {
        yield* git.execute({
          operation: "dependencies.fetch",
          cwd: repoPath,
          args: [
            "fetch",
            "--no-tags",
            "--no-write-fetch-head",
            remote.stdout.trim(),
            `refs/heads/${baseBranch}:${temporaryRef}`,
          ],
        });
        const fetched = yield* git.execute({
          operation: "dependencies.base",
          cwd: repoPath,
          args: ["rev-parse", "--verify", `${temporaryRef}^{commit}`],
        });
        return fetched.stdout.trim();
      }).pipe(
        Effect.ensuring(
          git
            .execute({
              operation: "dependencies.releaseRef",
              cwd: repoPath,
              args: ["update-ref", "-d", temporaryRef],
            })
            .pipe(Effect.ignore),
        ),
      );
      const dependencies = yield* Effect.forEach(observations, (item) =>
        Effect.gen(function* () {
          const contained = yield* git.execute({
            operation: "dependencies.contains",
            cwd: repoPath,
            args: ["merge-base", "--is-ancestor", item.commit!, baseCommit],
            allowNonZeroExit: true,
          });
          if (contained.exitCode !== 0)
            return {
              ...item,
              state: "unknown" as const,
              message: "The default branch no longer contains the verified merge.",
            };
          if (worktreePath) {
            const integrated = yield* git.execute({
              operation: "dependencies.integrated",
              cwd: worktreePath,
              args: ["merge-base", "--is-ancestor", item.commit!, "HEAD"],
              allowNonZeroExit: true,
            });
            if (integrated.exitCode !== 0)
              return {
                ...item,
                state: "integration_required" as const,
                message:
                  "This checkout does not contain the prerequisite merge. Integrate the default branch, then check again. Your work has been preserved.",
              };
          }
          return item;
        }),
      );
      yield* Effect.logDebug("Feature task dependencies checked", {
        taskId: task.id,
        states: dependencies.map((item) => item.state),
      });
      return { dependencies, baseCommit, baseBranch };
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Feature task dependency verification unavailable", {
          taskId: task.id,
          errorTag: cause._tag,
        }).pipe(
          Effect.as(
            unknown(
              "Could not verify prerequisites. Check GitHub access and the remote, then check again.",
            ),
          ),
        ),
      ),
    );
  });
  return FeatureTaskDependencyService.of({ check });
});
export const layer = Layer.effect(FeatureTaskDependencyService, make);
