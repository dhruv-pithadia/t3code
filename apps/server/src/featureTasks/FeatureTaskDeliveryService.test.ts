import {
  FeatureTaskId,
  GitManagerError,
  ProjectId,
  PullRequestOperationError,
  type FeatureTask,
  type PullRequestSummary,
} from "@yantrix/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as GitManager from "../git/GitManager.ts";
import * as PullRequests from "../pullRequest/PullRequestService.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";
import * as FeatureTaskDelivery from "./FeatureTaskDeliveryService.ts";

const taskId = FeatureTaskId.make("feature-task:delivery");
const projectId = ProjectId.make("project:delivery");
const task = {
  id: taskId,
  projectId,
  title: "Feature task delivery",
  objective: "Keep delivery state accurate.",
  acceptanceCriteria: [],
  decisions: [],
  nextAction: "Check the pull request.",
  handoff: "",
  status: "verifying",
  workspace: {
    repoPath: "/repo",
    worktreePath: "/repo-task",
    branch: "yantrix/task-delivery",
    createdAt: "2026-10-05T00:00:00.000Z",
  },
  threadIds: [],
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
} satisfies FeatureTask;

const pullRequest = {
  number: 42,
  title: "Feature task delivery",
  url: "https://github.com/acme/app/pull/42",
  baseRef: "main",
  headRef: "yantrix/task-delivery",
  state: "open",
  updatedAt: "2026-10-05T01:00:00.000Z",
  repositoryKey: "https://github.com/acme/app",
} satisfies GitManager.GitBranchPullRequest;

const summary = (
  checksState: "passing" | "failing" | "pending" | null | undefined,
  state: PullRequestSummary["state"] = "open",
  overrides: Partial<PullRequestSummary> = {},
) =>
  ({
    provider: "github",
    projectId,
    repository: "acme/app",
    number: 42,
    title: pullRequest.title,
    url: pullRequest.url,
    state,
    headBranch: pullRequest.headRef,
    baseBranch: pullRequest.baseRef,
    updatedAt: "2026-10-05T01:00:00.000Z",
    ...(checksState === undefined ? {} : { checksState }),
    ...overrides,
  }) satisfies PullRequestSummary;

const makeLayer = (input: {
  readonly task?: FeatureTask;
  readonly pr?: GitManager.GitBranchPullRequest | null;
  readonly summary?: PullRequestSummary;
  readonly cachedSummary?: PullRequestSummary;
  readonly freshSummary?: PullRequestSummary;
  readonly cacheState?: { invalidated: boolean };
  readonly summaryFails?: boolean;
  readonly branchPullRequestFails?: boolean;
  readonly events?: Array<string>;
}) =>
  FeatureTaskDelivery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(FeatureTasks.FeatureTaskService)({
          get: () => Effect.succeed({ task: input.task ?? task }),
        }),
        Layer.mock(GitManager.GitManager)({
          branchPullRequest: (request) =>
            input.branchPullRequestFails
              ? Effect.fail(
                  new GitManagerError({
                    operation: "branchPullRequest",
                    cwd: request.cwd,
                    detail: "Host unavailable.",
                  }),
                )
              : Effect.succeed(input.pr === undefined ? pullRequest : input.pr),
        }),
        Layer.mock(PullRequests.PullRequestService)({
          invalidate: ({ reference }) =>
            Effect.sync(() => {
              if (input.cacheState) input.cacheState.invalidated = true;
              input.events?.push(`invalidate:${reference?.number ?? "all"}`);
            }),
          summary: (
            request,
            options,
          ): Effect.Effect<PullRequestSummary, PullRequests.PullRequestError> => {
            input.events?.push(
              `summary:${request.number}:${String(request.allowStale)}:${String(options?.recoverTransientFailure)}`,
            );
            return input.summaryFails
              ? Effect.fail(
                  new PullRequestOperationError({
                    operation: "summary",
                    detail: "Checks unavailable.",
                  }),
                )
              : Effect.succeed(
                  input.cachedSummary && input.cacheState?.invalidated !== true
                    ? input.cachedSummary
                    : (input.freshSummary ?? input.summary ?? input.cachedSummary ?? summary(null)),
                );
          },
        }),
      ),
    ),
  );

const readDelivery = (input: Parameters<typeof makeLayer>[0] = {}) =>
  Effect.gen(function* () {
    const service = yield* FeatureTaskDelivery.FeatureTaskDeliveryService;
    return yield* service.get({ id: taskId });
  }).pipe(Effect.provide(makeLayer(input)));

it.effect("returns checks and current merge state only for the matching PR head", () =>
  Effect.gen(function* () {
    for (const [checks, state] of [
      ["passing", "open"],
      ["pending", "open"],
      ["failing", "open"],
      ["passing", "merged"],
      ["passing", "closed"],
    ] as const) {
      const result = yield* readDelivery({ summary: summary(checks, state) });
      assert.equal(result.pullRequest?.number, 42);
      assert.equal(result.pullRequest?.state, state);
      assert.equal(result.checks, checks);
      assert.equal(result.mergeState, state);
      assert.notEqual(result.updatedAt, pullRequest.updatedAt);
    }
  }),
);

it.effect("invalidates held PR data and requests a strict summary before reporting delivery", () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const cacheState = { invalidated: false };
    const result = yield* readDelivery({
      cachedSummary: summary("failing", "open", { title: "Cached open PR" }),
      freshSummary: summary("passing", "merged", { title: "Fresh merged PR" }),
      cacheState,
      events,
    });

    assert.isTrue(cacheState.invalidated);
    assert.deepEqual(events, ["invalidate:42", "summary:42:false:false"]);
    assert.equal(result.pullRequest?.title, "Fresh merged PR");
    assert.equal(result.pullRequest?.state, "merged");
    assert.equal(result.checks, "passing");
    assert.equal(result.mergeState, "merged");
  }),
);

it.effect("keeps absent PR and empty check results unknown rather than calling them passing", () =>
  Effect.gen(function* () {
    const noPr = yield* readDelivery({ pr: null });
    assert.isNull(noPr.pullRequest);
    assert.equal(noPr.checks, "unknown");
    assert.equal(noPr.mergeState, "unknown");
    assert.isNotNull(noPr.updatedAt);

    const noChecks = yield* readDelivery({ summary: summary(null) });
    assert.equal(noChecks.checks, "unknown");
    assert.isNotNull(noChecks.updatedAt);
  }),
);

it.effect("keeps checks unknown after a failed or unsupported read or a head mismatch", () =>
  Effect.gen(function* () {
    const failed = yield* readDelivery({ summaryFails: true });
    assert.equal(failed.checks, "unknown");
    assert.equal(failed.pullRequest?.number, pullRequest.number);
    assert.equal(failed.pullRequest?.title, pullRequest.title);
    assert.equal(failed.mergeState, "open");
    assert.isNotNull(failed.updatedAt);

    const unsupported = yield* readDelivery({ summary: summary(undefined) });
    assert.equal(unsupported.checks, "unknown");
    assert.isNotNull(unsupported.updatedAt);

    for (const state of ["merged", "closed"] as const) {
      const settled = yield* readDelivery({ summary: summary(undefined, state) });
      assert.equal(settled.pullRequest?.state, state);
      assert.equal(settled.mergeState, state);
      assert.equal(settled.checks, "unknown");
      assert.isNotNull(settled.updatedAt);
    }

    const wrongHead = yield* readDelivery({
      summary: summary("passing", "open", { headBranch: "someone-elses-branch" }),
    });
    assert.equal(wrongHead.checks, "unknown");
    assert.isNotNull(wrongHead.updatedAt);
  }),
);

it.effect("reports an unavailable PR lookup as unknown rather than no pull request", () =>
  Effect.gen(function* () {
    const result = yield* readDelivery({ branchPullRequestFails: true });
    assert.isNull(result.pullRequest);
    assert.equal(result.checks, "unknown");
    assert.equal(result.mergeState, "unknown");
    assert.isNull(result.updatedAt);
  }),
);

it.effect("keeps an unbound task unverified", () =>
  Effect.gen(function* () {
    const result = yield* readDelivery({ task: { ...task, workspace: null } });
    assert.isNull(result.pullRequest);
    assert.equal(result.checks, "unknown");
    assert.equal(result.mergeState, "unknown");
    assert.isNull(result.updatedAt);
  }),
);
