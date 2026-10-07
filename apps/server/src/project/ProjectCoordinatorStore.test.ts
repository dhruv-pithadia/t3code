import {
  MessageId,
  ModelSelection,
  ProjectCoordinatorRouteInput,
  ProjectId,
  ThreadId,
} from "@yantrix/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as NodeSqliteClient from "@yantrix/shared/nodeSqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as Coordinator from "./ProjectCoordinatorStore.ts";

const projectId = ProjectId.make("project:coordinator-store");
const coordinatorThreadId = ThreadId.make("thread:coordinator-store");
const workerThreadId = ThreadId.make("thread:coordinator-worker");
const requestId = "request:one";
const messageId = MessageId.make("message:coordinator-one");
const modelSelection = Schema.decodeUnknownSync(ModelSelection)({
  instanceId: "codex",
  model: "gpt-5",
});

const layer = it.layer(
  Coordinator.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations();
  const now = "2026-10-05T00:00:00.000Z";
  yield* sql`DELETE FROM project_coordinator_notifications`;
  yield* sql`DELETE FROM project_coordinator_requests`;
  yield* sql`DELETE FROM project_coordinator_decisions`;
  yield* sql`DELETE FROM project_coordinator_projects`;
  yield* sql`DELETE FROM orchestration_v2_projection_threads`;
  yield* sql`DELETE FROM projection_projects`;
  yield* sql`INSERT INTO projection_projects (
    project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at
  ) VALUES (${projectId}, 'Workspace', '/workspace', '[]', ${now}, ${now}, NULL)`;
  for (const threadId of [coordinatorThreadId, workerThreadId]) {
    yield* sql`INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
      active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
    ) VALUES (${threadId}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
      ${now}, ${now}, NULL, NULL, '{}')`;
  }
});

layer("ProjectCoordinatorStore", (test) => {
  test.effect("preserves original requests, order, and route idempotency", () =>
    Effect.gen(function* () {
      const store = yield* Coordinator.ProjectCoordinatorStore;
      yield* seedProject;
      const empty = yield* store.read({ projectId });
      assert.isNull(empty.threadId);
      const opened = yield* store.ensureProject({
        projectId,
        threadId: coordinatorThreadId,
        modelSelection,
      });
      assert.equal(opened.threadId, coordinatorThreadId);

      const request = yield* store.recordRequest({
        projectId,
        id: requestId,
        sourceMessageId: messageId,
        text: "Please keep this request exactly as written.",
      });
      assert.equal(request.sequence, 1);
      assert.deepEqual(
        yield* store.recordRequest({
          projectId,
          id: requestId,
          sourceMessageId: messageId,
          text: request.text,
        }),
        request,
      );

      const route = {
        sourceMessageId: messageId,
        kind: "discussion",
      } satisfies ProjectCoordinatorRouteInput;
      const payload = { route, startupPacket: null } as const;
      const reserved = yield* store.reserveRoute({
        projectId,
        sourceMessageId: messageId,
        route: "discussion",
        taskId: null,
        workerThreadId: null,
        commandId: null,
        routePayload: payload,
      });
      assert.equal(reserved.status, "discussed");
      assert.deepEqual(
        yield* store.reserveRoute({
          projectId,
          sourceMessageId: messageId,
          route: "discussion",
          taskId: null,
          workerThreadId: null,
          commandId: null,
          routePayload: payload,
        }),
        reserved,
      );

      const conflict = yield* Effect.result(
        store.recordRequest({
          projectId,
          id: requestId,
          sourceMessageId: messageId,
          text: "Changed original text",
        }),
      );
      assert.isTrue(Result.isFailure(conflict));
      if (Result.isFailure(conflict)) assert.equal(conflict.failure.code, "conflict");
    }),
  );

  test.effect("uses optimistic context revisions and keeps pending decisions until resolved", () =>
    Effect.gen(function* () {
      const store = yield* Coordinator.ProjectCoordinatorStore;
      yield* seedProject;
      yield* store.ensureProject({ projectId, threadId: coordinatorThreadId, modelSelection });
      yield* store.recordRequest({
        projectId,
        id: requestId,
        sourceMessageId: messageId,
        text: "The worker needs a decision.",
      });

      const decisionInput = {
        projectId,
        id: "decision:one",
        text: "Keep the database change in SQLite.",
        sourceMessageId: messageId,
        expectedContextRevision: 0,
      } as const;
      const withDecision = yield* store.recordDecision(decisionInput);
      assert.equal(withDecision.contextRevision, 1);
      assert.equal(withDecision.decisions[0]?.version, 1);
      assert.equal((yield* store.recordDecision(decisionInput)).contextRevision, 1);

      const stale = yield* Effect.result(
        store.recordDecision({
          ...decisionInput,
          id: "decision:two",
          text: "A stale decision.",
        }),
      );
      assert.isTrue(Result.isFailure(stale));
      if (Result.isFailure(stale)) assert.equal(stale.failure.code, "conflict");

      const pending = yield* store.recordNotification({
        projectId,
        id: "notification:pending-decision",
        taskId: null,
        workerThreadId,
        sourceMessageId: messageId,
        kind: "pending_decision",
        summary: "The worker is waiting for a choice.",
      });
      assert.equal(pending.notifications[0]?.status, "pending");
      const observed = yield* store.observeNotification({
        projectId,
        id: "notification:pending-decision",
      });
      assert.isNotNull(observed.notifications[0]?.observedAt);
      assert.equal(observed.notifications[0]?.status, "pending");
      const resolved = yield* store.resolveNotification({
        projectId,
        id: "notification:pending-decision",
        resolutionMessageId: MessageId.make("message:coordinator-answer"),
      });
      assert.equal(resolved.notifications[0]?.status, "resolved");
      assert.equal(resolved.notifications[0]?.resolutionMessageId, "message:coordinator-answer");

      const workerState = yield* store.readForThread(workerThreadId);
      assert.isNotNull(workerState);
      assert.isFalse(workerState!.isCoordinator);
      assert.equal(workerState!.snapshot.contextRevision, 1);
    }),
  );
});
