import { FeatureTaskError, FeatureTaskId, ProjectId, ThreadId } from "@yantrix/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Result from "effect/Result";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as NodeSqliteClient from "@yantrix/shared/nodeSqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";

const isFeatureTaskError = Schema.is(FeatureTaskError);

const projectId = ProjectId.make("project:feature-tasks");
const threadA = ThreadId.make("thread:feature-a");
const threadB = ThreadId.make("thread:feature-b");
const taskId = FeatureTaskId.make("feature-task:continuity");

const layer = it.layer(
  FeatureTasks.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

layer("FeatureTaskService", (it) => {
  it.effect(
    "persists task state, makes create retries idempotent, and enforces optimistic updates",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const service = yield* FeatureTasks.FeatureTaskService;
        yield* runMigrations();
        yield* sql`DELETE FROM feature_tasks`;
        yield* sql`DELETE FROM orchestration_v2_projection_threads`;
        yield* sql`DELETE FROM projection_projects`;
        const now = "2026-10-05T00:00:00.000Z";
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES (${projectId}, 'Workspace', '/workspace', '[]', ${now}, ${now}, NULL)`;
        for (const threadId of [threadA, threadB]) {
          yield* sql`INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
        ) VALUES (${threadId}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
          ${now}, ${now}, NULL, NULL, '{}')`;
        }

        const input = {
          id: taskId,
          projectId,
          title: "Persistent intent",
          objective: "Keep the feature resumable across conversations.",
          acceptanceCriteria: ["Data survives restart."],
          decisions: ["Use SQLite."],
          nextAction: "Implement persistence.",
          handoff: "Continue from the next action.",
          threadIds: [threadA],
        } as const;
        const created = yield* service.create(input);
        assert.equal(created.task.version, 1);
        assert.deepEqual((yield* service.create(input)).task, created.task);

        const updated = yield* service.update({
          id: taskId,
          expectedVersion: 1,
          patch: { status: "building", threadIds: [threadA, threadB], archived: true },
        });
        assert.equal(updated.task.version, 2);
        assert.equal(updated.task.status, "building");
        assert.isNotNull(updated.task.archivedAt);
        assert.deepEqual((yield* service.create(input)).task, updated.task);

        const stale = yield* Effect.result(
          service.update({
            id: taskId,
            expectedVersion: 1,
            patch: { nextAction: "stale write" },
          }),
        );
        assert.isTrue(Result.isFailure(stale));
        if (Result.isFailure(stale)) assert.equal(stale.failure.code, "conflict");

        const unarchived = yield* service.update({
          id: taskId,
          expectedVersion: 2,
          patch: { archived: false, threadIds: [threadB] },
        });
        assert.isNull(unarchived.task.archivedAt);
        assert.deepEqual(unarchived.task.threadIds, [threadB]);
        assert.equal(yield* service.readForThread(threadA), null);
        assert.equal((yield* service.readForThread(threadB))?.id, taskId);
        assert.equal((yield* service.get({ id: taskId })).task.version, 3);
      }),
  );

  it.effect(
    "rejects cross-project and already-owned conversation links while preserving existing references",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const service = yield* FeatureTasks.FeatureTaskService;
        yield* runMigrations();
        yield* sql`DELETE FROM feature_tasks`;
        yield* sql`DELETE FROM orchestration_v2_projection_threads`;
        yield* sql`DELETE FROM projection_projects`;
        const now = "2026-10-05T00:00:00.000Z";
        for (const [id, root] of [
          [projectId, "/workspace"],
          [ProjectId.make("project:other"), "/other"],
        ] as const) {
          yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
          VALUES (${id}, 'Workspace', ${root}, '[]', ${now}, ${now}, NULL)`;
        }
        yield* sql`INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (${threadA}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
        ${now}, ${now}, NULL, NULL, '{}')`;
        yield* sql`INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (${threadB}, ${ProjectId.make("project:other")}, 'Conversation', 'codex', 'full-access', 'default', NULL,
        ${now}, ${now}, NULL, NULL, '{}')`;
        const base = {
          id: taskId,
          projectId,
          title: "Persistent intent",
          objective: "Keep the feature resumable across conversations.",
          acceptanceCriteria: ["Data survives restart."],
          decisions: ["Use SQLite."],
          nextAction: "Continue.",
          handoff: "Resume safely.",
          threadIds: [threadA],
        } as const;
        yield* service.create(base);
        const otherTask = { ...base, id: FeatureTaskId.make("feature-task:other"), threadIds: [] };
        yield* service.create(otherTask);
        const conflict = yield* Effect.result(
          service.update({
            id: otherTask.id,
            expectedVersion: 1,
            patch: { threadIds: [threadA] },
          }),
        );
        assert.isTrue(Result.isFailure(conflict));
        if (Result.isFailure(conflict)) assert.equal(conflict.failure.code, "conflict");
        const invalid = yield* Effect.result(
          service.update({
            id: taskId,
            expectedVersion: 1,
            patch: { threadIds: [threadA, threadB] },
          }),
        );
        assert.isTrue(Result.isFailure(invalid));
        if (Result.isFailure(invalid)) assert.equal(invalid.failure.code, "invalid_link");

        yield* sql`DELETE FROM orchestration_v2_projection_threads WHERE thread_id = ${threadA}`;
        const retained = yield* service.update({
          id: taskId,
          expectedVersion: 1,
          patch: { nextAction: "Resume with the retained link." },
        });
        assert.deepEqual(retained.task.threadIds, [threadA]);
      }),
  );

  it.effect("maps malformed persisted JSON to a safe storage error", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* FeatureTasks.FeatureTaskService;
      yield* runMigrations();
      yield* sql`DELETE FROM feature_tasks`;
      yield* sql`DELETE FROM projection_projects`;
      const now = "2026-10-05T00:00:00.000Z";
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES (${projectId}, 'Workspace', '/workspace', '[]', ${now}, ${now}, NULL)`;
      yield* service.create({
        id: taskId,
        projectId,
        title: "Private title",
        objective: "Private objective",
        acceptanceCriteria: ["Private criterion"],
        decisions: [],
        nextAction: "Private next action",
        handoff: "Private handoff",
        threadIds: [],
      });
      const secret = "TASK-PRIVATE-CORRUPT-CONTENT";
      const corruptJson = secret;
      yield* sql`UPDATE feature_tasks SET acceptance_criteria_json = ${corruptJson} WHERE task_id = ${taskId}`;
      const logs: Array<unknown> = [];
      const logger = Logger.layer([
        Logger.make((entry) => {
          logs.push(entry);
        }),
      ]);

      const getResult = yield* Effect.result(service.get({ id: taskId })).pipe(
        Effect.provide(logger),
      );
      const listResult = yield* Effect.result(service.list({ projectId })).pipe(
        Effect.provide(logger),
      );
      assert.isTrue(Result.isFailure(getResult));
      assert.isTrue(Result.isFailure(listResult));
      if (Result.isFailure(getResult)) {
        assert.isTrue(isFeatureTaskError(getResult.failure));
        assert.equal(getResult.failure.code, "storage");
        assert.isFalse(getResult.failure.message.includes(secret));
      }
      if (Result.isFailure(listResult)) {
        assert.isTrue(isFeatureTaskError(listResult.failure));
        assert.equal(listResult.failure.code, "storage");
        assert.isFalse(listResult.failure.message.includes(secret));
      }
      assert.isFalse(NodeUtil.inspect(logs, { depth: null }).includes(secret));
    }),
  );
});
