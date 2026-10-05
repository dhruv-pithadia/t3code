import { FeatureTaskError, FeatureTaskId, ProjectId, ThreadId } from "@yantrix/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeUtil from "node:util";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Result from "effect/Result";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeSqliteClient from "@yantrix/shared/nodeSqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";

const isFeatureTaskError = Schema.is(FeatureTaskError);

const projectId = ProjectId.make("project:feature-tasks");
const threadA = ThreadId.make("thread:feature-a");
const threadB = ThreadId.make("thread:feature-b");
const taskId = FeatureTaskId.make("feature-task:continuity");
const encodeThreadWorkspace = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ worktreePath: Schema.String, branch: Schema.String })),
);

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

  it.effect(
    "persists workspace binding across service reconstruction and publishes versioned changes",
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
        VALUES (${projectId}, 'Workspace', '/repo', '[]', ${now}, ${now}, NULL)`;
        yield* sql`INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (${threadA}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
        ${now}, ${now}, NULL, NULL, '{}')`;
        yield* service.create({
          id: taskId,
          projectId,
          title: "Workspace persistence",
          objective: "Keep a task workspace durable.",
          acceptanceCriteria: [],
          decisions: [],
          nextAction: "Continue safely.",
          handoff: "Resume from the saved workspace.",
          threadIds: [],
        });

        const changes = yield* Stream.runCollect(
          service.subscribe({ projectId }).pipe(Stream.take(2)),
        ).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const binding = {
          repoPath: "/repo",
          worktreePath: "/repo/task-checkout",
          branch: "yantrix/task-persistence",
          createdAt: now,
        } as const;
        const bound = yield* service.saveWorkspaceBinding({ id: taskId, binding });
        assert.deepEqual(bound.task.workspace, binding);
        assert.equal(bound.task.version, 2);

        const snapshots = yield* Fiber.join(changes);
        assert.equal(snapshots.length, 2);
        assert.isNull(snapshots[0]?.tasks[0]?.workspace);
        assert.deepEqual(snapshots[1]?.tasks[0]?.workspace, binding);
        assert.equal(snapshots[1]?.tasks[0]?.version, 2);

        const stale = yield* Effect.result(
          service.update({ id: taskId, expectedVersion: 1, patch: { nextAction: "stale" } }),
        );
        assert.isTrue(Result.isFailure(stale));
        if (Result.isFailure(stale)) assert.equal(stale.failure.code, "conflict");
        assert.equal(
          (yield* service.saveWorkspaceBinding({ id: taskId, binding })).task.version,
          2,
        );

        const environment = yield* Effect.context();
        const rebuiltContext = yield* Layer.build(
          FeatureTasks.layer.pipe(Layer.provide(Layer.succeedContext(environment))),
        );
        const rebuilt = Context.get(rebuiltContext, FeatureTasks.FeatureTaskService);
        assert.deepEqual((yield* rebuilt.get({ id: taskId })).task.workspace, binding);
      }),
  );

  it.effect("requires linked conversations to match the persisted workspace path and branch", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* FeatureTasks.FeatureTaskService;
      yield* runMigrations();
      yield* sql`DELETE FROM feature_tasks`;
      yield* sql`DELETE FROM orchestration_v2_projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      const now = "2026-10-05T00:00:00.000Z";
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES (${projectId}, 'Workspace', '/repo', '[]', ${now}, ${now}, NULL)`;
      yield* sql`INSERT INTO orchestration_v2_projection_threads (
        thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
        active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
      ) VALUES (${threadA}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
        ${now}, ${now}, NULL, NULL, '{}')`;
      yield* service.create({
        id: taskId,
        projectId,
        title: "Workspace link",
        objective: "Link only matching conversations.",
        acceptanceCriteria: [],
        decisions: [],
        nextAction: "Continue.",
        handoff: "Use the shared checkout.",
        threadIds: [],
      });
      const binding = {
        repoPath: "/repo",
        worktreePath: "/repo/task-checkout",
        branch: "yantrix/task-link",
        createdAt: now,
      } as const;
      yield* service.saveWorkspaceBinding({ id: taskId, binding });

      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${encodeThreadWorkspace(
        {
          worktreePath: binding.worktreePath,
          branch: binding.branch,
        },
      )} WHERE thread_id = ${threadA}`;
      const linked = yield* service.update({
        id: taskId,
        expectedVersion: 2,
        patch: { threadIds: [threadA] },
      });
      assert.deepEqual(linked.task.threadIds, [threadA]);

      yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = ${encodeThreadWorkspace(
        {
          worktreePath: binding.worktreePath,
          branch: "another-branch",
        },
      )} WHERE thread_id = ${threadA}`;
      const mismatch = yield* Effect.result(
        service.update({ id: taskId, expectedVersion: 3, patch: { threadIds: [threadA] } }),
      );
      assert.isTrue(Result.isFailure(mismatch));
      if (Result.isFailure(mismatch)) assert.equal(mismatch.failure.code, "conflict");
    }),
  );

  it.effect("keeps checkout and repository-branch ownership unique, including archived tasks", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const service = yield* FeatureTasks.FeatureTaskService;
      yield* runMigrations();
      yield* sql`DELETE FROM feature_tasks`;
      yield* sql`DELETE FROM orchestration_v2_projection_threads`;
      yield* sql`DELETE FROM projection_projects`;
      const now = "2026-10-05T00:00:00.000Z";
      yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
        VALUES (${projectId}, 'Workspace', '/repo', '[]', ${now}, ${now}, NULL)`;
      const secondTaskId = FeatureTaskId.make("feature-task:workspace-owner-second");
      for (const [id, title] of [
        [taskId, "Owner"],
        [secondTaskId, "Contender"],
      ] as const) {
        yield* service.create({
          id,
          projectId,
          title,
          objective: "Own a separate checkout.",
          acceptanceCriteria: [],
          decisions: [],
          nextAction: "Continue.",
          handoff: "Resume safely.",
          threadIds: [],
        });
      }
      const owned = {
        repoPath: "/repo",
        worktreePath: "/repo/task-owner",
        branch: "yantrix/task-owner",
        createdAt: now,
      } as const;
      yield* service.saveWorkspaceBinding({ id: taskId, binding: owned });

      const sharedCheckout = yield* Effect.result(
        service.saveWorkspaceBinding({
          id: secondTaskId,
          binding: { ...owned, repoPath: "/another-repo", branch: "another-branch" },
        }),
      );
      assert.isTrue(Result.isFailure(sharedCheckout));
      if (Result.isFailure(sharedCheckout)) assert.equal(sharedCheckout.failure.code, "conflict");

      const sharedBranch = yield* Effect.result(
        service.saveWorkspaceBinding({
          id: secondTaskId,
          binding: { ...owned, worktreePath: "/repo/other-checkout" },
        }),
      );
      assert.isTrue(Result.isFailure(sharedBranch));
      if (Result.isFailure(sharedBranch)) assert.equal(sharedBranch.failure.code, "conflict");

      yield* service.update({ id: taskId, expectedVersion: 2, patch: { archived: true } });
      const archivedOwner = yield* Effect.result(
        service.saveWorkspaceBinding({
          id: secondTaskId,
          binding: { ...owned, worktreePath: "/repo/other-checkout" },
        }),
      );
      assert.isTrue(Result.isFailure(archivedOwner));
      if (Result.isFailure(archivedOwner)) assert.equal(archivedOwner.failure.code, "conflict");
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
