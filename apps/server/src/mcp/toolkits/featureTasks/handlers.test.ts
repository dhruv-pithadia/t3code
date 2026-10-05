import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  FeatureTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type FeatureTask,
  type OrchestrationV2ThreadShell,
} from "@yantrix/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as FeatureTasks from "../../../featureTasks/FeatureTaskService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { FeatureTasksHandlersLive } from "./handlers.ts";
import { FeatureTasksToolkit } from "./tools.ts";

const projectId = ProjectId.make("task-project");
const threadId = ThreadId.make("task-thread");
const providerInstanceId = ProviderInstanceId.make("codex");
const task: FeatureTask = {
  id: FeatureTaskId.make("persistent-task"),
  projectId,
  title: "Continuity",
  objective: "Continue a saved task",
  acceptanceCriteria: [],
  decisions: [],
  nextAction: "Verify",
  handoff: "",
  threadIds: [threadId],
  status: "requested",
  archivedAt: null,
  version: 1,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
};

function dependencies(
  overrides: {
    projectId?: ProjectId;
    capabilities?: McpInvocationContext.McpInvocationScope["capabilities"];
    activeRunId?: string | null;
    onUpdate?: () => void;
  } = {},
) {
  return Layer.mergeAll(
    Layer.succeed(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("task-environment"),
      threadId,
      providerInstanceId,
      providerSessionId: "task-session",
      issuedAt: 0,
      capabilities: overrides.capabilities ?? new Set(["orchestration" as const]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.succeed({
          id: threadId,
          projectId: overrides.projectId ?? projectId,
          providerInstanceId,
          activeRunId: overrides.activeRunId === undefined ? "active-run" : overrides.activeRunId,
          archivedAt: null,
          deletedAt: null,
        } as OrchestrationV2ThreadShell),
    }),
    Layer.mock(FeatureTasks.FeatureTaskService)({
      get: () => Effect.succeed({ task }),
      readForThread: () => Effect.succeed(task),
      update: () =>
        Effect.sync(() => {
          overrides.onUpdate?.();
          return { task };
        }),
    }),
  );
}

it.effect("reads the saved task linked to the calling conversation", () =>
  Effect.gen(function* () {
    const deps = dependencies();
    const toolkit = yield* FeatureTasksToolkit.pipe(
      Effect.provide(FeatureTasksHandlersLive.pipe(Layer.provide(deps))),
    );
    const result = yield* toolkit
      .handle("yantrix_feature_task_read", {})
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(deps));
    expect(result.at(-1)?.result).toEqual(task);
  }),
);

it.effect("rejects edits to a task outside the calling project", () =>
  Effect.gen(function* () {
    let updated = false;
    const deps = dependencies({
      projectId: ProjectId.make("other-project"),
      onUpdate: () => {
        updated = true;
      },
    });
    const toolkit = yield* FeatureTasksToolkit.pipe(
      Effect.provide(FeatureTasksHandlersLive.pipe(Layer.provide(deps))),
    );
    const result = yield* toolkit
      .handle("yantrix_feature_task_update", {
        id: task.id,
        expectedVersion: 1,
        patch: { handoff: "changed" },
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(deps));
    expect(result.at(-1)?.result).toMatchObject({ code: "invalid_request" });
    expect(updated).toBe(false);
  }),
);

it.effect("rejects task access before lookup when orchestration capability is missing", () =>
  Effect.gen(function* () {
    const deps = dependencies({ capabilities: new Set() });
    const toolkit = yield* FeatureTasksToolkit.pipe(
      Effect.provide(FeatureTasksHandlersLive.pipe(Layer.provide(deps))),
    );
    const result = yield* toolkit
      .handle("yantrix_feature_task_read", {})
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(deps));
    expect(result.at(-1)?.result).toMatchObject({ code: "capability_denied" });
  }),
);

it.effect("rejects updates from an inactive provider run", () =>
  Effect.gen(function* () {
    let updated = false;
    const deps = dependencies({
      activeRunId: null,
      onUpdate: () => {
        updated = true;
      },
    });
    const toolkit = yield* FeatureTasksToolkit.pipe(
      Effect.provide(FeatureTasksHandlersLive.pipe(Layer.provide(deps))),
    );
    const result = yield* toolkit
      .handle("yantrix_feature_task_update", {
        id: task.id,
        expectedVersion: 1,
        patch: { nextAction: "Continue" },
      })
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(deps));
    expect(result.at(-1)?.result).toMatchObject({ code: "parent_not_active" });
    expect(updated).toBe(false);
  }),
);
