import { assert } from "@effect/vitest";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2Run,
  type ServerProvider,
} from "@yantrix/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as FeatureTasks from "../featureTasks/FeatureTaskService.ts";
import * as Workspaces from "../featureTasks/FeatureTaskWorkspaceService.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import type { ProviderAdapterV2Shape } from "../orchestration-v2/ProviderAdapter.ts";
import * as Recovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { makeProviderRegistryLayer } from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Projects from "./ProjectService.ts";
import * as CoordinatorStore from "./ProjectCoordinatorStore.ts";

export const projectId = ProjectId.make("project:coordinator-recovery");
export const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-6.1",
} as const;

const project = {
  id: projectId,
  title: "Recovery project",
  workspaceRoot: "/workspace",
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: modelSelection,
  defaultThreadEnvMode: null,
  autoPull: false,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-10-07T00:00:00.000Z",
  updatedAt: "2026-10-07T00:00:00.000Z",
  deletedAt: null,
} as const;

const provider = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: project.createdAt,
  models: [{ slug: modelSelection.model, name: "GPT 6.1", isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Recovery integration tests do not execute provider subprocesses"),
} as ProviderAdapterV2Shape;

export function makeRecoveryHarness(
  options: {
    readonly loseFirstWorkerLaunchResult?: boolean;
    readonly continueThreadsAfterServerUpdate?: boolean;
  } = {},
) {
  const launchCalls: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const workspaceChecks: Array<
    Parameters<Workspaces.FeatureTaskWorkspaceService["Service"]["assertThreadWorkspace"]>[0]
  > = [];
  let loseResult = options.loseFirstWorkerLaunchResult === true;
  const database = SqlitePersistenceMemory;
  const runtime = makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "project-coordinator-recovery" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    {
      databaseLayer: database,
      runEffectWorker: false,
      continueThreadsAfterServerUpdate: options.continueThreadsAfterServerUpdate ?? false,
    },
  );
  const threads = Threads.layer.pipe(Layer.provide(runtime));
  const tasks = FeatureTasks.layer.pipe(Layer.provide(database));
  const stores = Layer.mergeAll(
    CoordinatorStore.layer,
    EventStore.layer,
    ProjectionStore.layer,
    EffectOutbox.layer,
  ).pipe(Layer.provide(database));
  const workspaceBoundary = Layer.effect(
    Workspaces.FeatureTaskWorkspaceService,
    Effect.gen(function* () {
      const featureTasks = yield* FeatureTasks.FeatureTaskService;
      return Workspaces.FeatureTaskWorkspaceService.of({
        inspect: () => Effect.die("Unused workspace inspection"),
        attach: () => Effect.die("Unused workspace attachment"),
        ensure: ({ id }) =>
          Effect.gen(function* () {
            const { task } = yield* featureTasks.get({ id });
            const binding = task.workspace ?? {
              repoPath: project.workspaceRoot,
              worktreePath: `/workspace/tasks/${id}`,
              branch: `feature/${id}`,
              createdAt: project.createdAt,
            };
            if (task.workspace === null || task.workspace === undefined)
              yield* featureTasks.saveWorkspaceBinding({ id, binding });
            return { state: "ready" as const, binding, recoveryAvailable: true };
          }),
        assertThreadWorkspace: (input) =>
          Effect.gen(function* () {
            workspaceChecks.push(input);
            assert.isNotNull(input.taskId);
            if (input.taskId === null) return;
            const { task } = yield* featureTasks.get({ id: input.taskId });
            assert.equal(input.worktreePath, task.workspace?.worktreePath);
            assert.equal(input.branch, task.workspace?.branch);
            assert.include(task.threadIds, input.threadId);
          }),
      });
    }),
  ).pipe(Layer.provide(tasks));
  const launchBoundary = Layer.effect(
    ThreadLaunch.ThreadLaunchService,
    Effect.gen(function* () {
      const threadService = yield* Threads.ThreadManagementService;
      const featureTasks = yield* FeatureTasks.FeatureTaskService;
      return ThreadLaunch.ThreadLaunchService.of({
        retryPreparation: () => Effect.die("Unused preparation retry"),
        launch: (input) =>
          Effect.gen(function* () {
            launchCalls.push(input);
            if (input.threadId === undefined)
              return yield* new ThreadLaunch.ThreadLaunchError({
                operation: "create-thread",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: "Stable thread identity required",
              });
            yield* threadService
              .dispatch({
                type: "thread.create",
                commandId: input.commandId,
                threadId: input.threadId,
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                runtimeMode: input.runtimeMode,
                interactionMode: input.interactionMode,
                branch: input.workspaceStrategy.branch ?? null,
                worktreePath:
                  input.workspaceStrategy.type === "existing_worktree"
                    ? input.workspaceStrategy.worktreePath
                    : null,
                createdBy: input.createdBy,
                creationSource: input.creationSource,
              })
              .pipe(Effect.orDie);
            if (input.initialMessage !== undefined) {
              const task = yield* featureTasks.readForThread(input.threadId).pipe(Effect.orDie);
              assert.isNotNull(
                task,
                "The feature link must be committed before a launch can accept its first message",
              );
              assert.equal(
                task?.workspace?.worktreePath,
                input.workspaceStrategy.type === "existing_worktree"
                  ? input.workspaceStrategy.worktreePath
                  : null,
              );
              assert.isDefined(input.initialMessage.messageId);
              yield* threadService
                .dispatch({
                  type: "message.dispatch",
                  commandId: CommandId.make(`${input.commandId}:initial-message`),
                  threadId: input.threadId,
                  messageId: input.initialMessage.messageId!,
                  text: input.initialMessage.text,
                  attachments: input.initialMessage.attachments,
                  senderThreadId: input.initialMessage.senderThreadId,
                  modelSelection: input.modelSelection,
                  dispatchMode: { type: "defer_start", workspaceStrategy: input.workspaceStrategy },
                  createdBy: input.createdBy,
                  creationSource: input.creationSource,
                })
                .pipe(Effect.orDie);
              if (loseResult) {
                loseResult = false;
                return yield* new ThreadLaunch.ThreadLaunchError({
                  operation: "dispatch-message",
                  commandId: input.commandId,
                  projectId: input.projectId,
                  threadId: input.threadId,
                  cause: "Accepted launch response was lost",
                });
              }
            }
            return {
              threadId: input.threadId,
              projection: yield* threadService
                .getThreadProjection(input.threadId)
                .pipe(Effect.orDie),
              resumed: launchCalls.filter((call) => call.commandId === input.commandId).length > 1,
            };
          }),
      });
    }),
  ).pipe(Layer.provide(Layer.merge(threads, tasks)));
  const settings = ServerSettings.layerTest({
    continueThreadsAfterServerUpdate: options.continueThreadsAfterServerUpdate ?? false,
  });
  const recovery = Recovery.layer.pipe(
    Layer.provide(Layer.mergeAll(stores, runtime, IdAllocator.layer, settings)),
  );
  const layer = Layer.mergeAll(
    database,
    runtime,
    threads,
    tasks,
    stores,
    launchBoundary,
    workspaceBoundary,
    recovery,
    settings,
    makeProviderRegistryLayer([provider]),
    Layer.mock(Projects.ProjectService)({
      getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    }),
  );
  return { layer, launchCalls, workspaceChecks };
}

export const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
    VALUES (${projectId}, ${project.title}, ${project.workspaceRoot}, '[]', ${project.createdAt}, ${project.updatedAt}, NULL)`;
});

export const completeRun = Effect.fn("coordinatorRecoveryTest.completeRun")(function* (
  threadId: Parameters<Threads.ThreadManagementService["Service"]["getThreadProjection"]>[0],
  run: OrchestrationV2Run,
) {
  const sink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  yield* sink.write({
    events: [
      {
        id: EventId.make(`event:coordinator-test:completed:${run.id}`),
        type: "run.updated",
        threadId,
        runId: run.id,
        providerInstanceId: run.providerInstanceId,
        occurredAt: now,
        payload: { ...run, status: "completed", completedAt: now, queuePosition: null },
      },
    ],
  });
});
