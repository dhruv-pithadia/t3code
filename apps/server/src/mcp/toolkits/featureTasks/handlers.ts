import { OrchestratorMcpFailure } from "@yantrix/contracts";
import * as Effect from "effect/Effect";

import * as FeatureTasks from "../../../featureTasks/FeatureTaskService.ts";
import * as FeatureTaskWorkspaces from "../../../featureTasks/FeatureTaskWorkspaceService.ts";
import * as FeatureTaskDelivery from "../../../featureTasks/FeatureTaskDeliveryService.ts";
import { readCaller, readMutationCaller, unavailable } from "../../threadAccess.ts";
import { FeatureTasksToolkit } from "./tools.ts";

const missing = () =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message: "The feature task was not found in the calling project.",
  });

export const FeatureTasksHandlersLive = FeatureTasksToolkit.toLayer({
  yantrix_feature_task_list: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const { tasks: all } = yield* tasks
        .list({ projectId: caller.projectId })
        .pipe(Effect.mapError(unavailable));
      const cursor = input.cursor ?? 0;
      const limit = input.limit ?? 20;
      return {
        tasks: all
          .slice(cursor, cursor + limit)
          .map(({ id, title, status, version, archivedAt, threadIds }) => ({
            id,
            title,
            status,
            version,
            archivedAt,
            threadIds,
          })),
        nextCursor: cursor + limit < all.length ? cursor + limit : null,
      };
    }),
  yantrix_feature_task_read: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const task = yield* (
        input.id === undefined
          ? tasks.readForThread(caller.id)
          : tasks.get({ id: input.id }).pipe(Effect.map(({ task }) => task))
      ).pipe(Effect.mapError(missing));
      if (task === null || task.projectId !== caller.projectId) return yield* missing();
      return task;
    }),
  yantrix_feature_task_create: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readMutationCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      return (yield* tasks
        .create({ ...input, projectId: caller.projectId })
        .pipe(Effect.mapError(unavailable))).task;
    }),
  yantrix_feature_task_update: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readMutationCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const { task } = yield* tasks.get({ id: input.id }).pipe(Effect.mapError(missing));
      if (task.projectId !== caller.projectId) return yield* missing();
      return (yield* tasks.update(input).pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: "invalid_request",
              message:
                error.code === "conflict"
                  ? "The task changed. Read it again and apply your edit using its current version."
                  : "The task update could not be saved. Check its conversation links and try again.",
            }),
        ),
      )).task;
    }),
  yantrix_feature_task_workspace_inspect: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const task = yield* tasks.get({ id: input.id }).pipe(
        Effect.map(({ task }) => task),
        Effect.mapError(missing),
      );
      if (task.projectId !== caller.projectId) return yield* missing();
      const workspaces = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
      return yield* workspaces.inspect(input).pipe(Effect.mapError(unavailable));
    }),
  yantrix_feature_task_workspace_ensure: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readMutationCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const task = yield* tasks.get({ id: input.id }).pipe(
        Effect.map(({ task }) => task),
        Effect.mapError(missing),
      );
      if (task.projectId !== caller.projectId) return yield* missing();
      const workspaces = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
      return yield* workspaces.ensure(input).pipe(Effect.mapError(unavailable));
    }),
  yantrix_feature_task_workspace_attach: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readMutationCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const task = yield* tasks.get({ id: input.id }).pipe(
        Effect.map(({ task }) => task),
        Effect.mapError(missing),
      );
      if (task.projectId !== caller.projectId) return yield* missing();
      const workspaces = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
      return yield* workspaces.attach(input).pipe(Effect.mapError(unavailable));
    }),
  yantrix_feature_task_delivery: (input) =>
    Effect.gen(function* () {
      const { caller } = yield* readCaller();
      const tasks = yield* FeatureTasks.FeatureTaskService;
      const task = yield* tasks.get({ id: input.id }).pipe(
        Effect.map(({ task }) => task),
        Effect.mapError(missing),
      );
      if (task.projectId !== caller.projectId) return yield* missing();
      const delivery = yield* FeatureTaskDelivery.FeatureTaskDeliveryService;
      return yield* delivery.get(input).pipe(Effect.mapError(unavailable));
    }),
});
