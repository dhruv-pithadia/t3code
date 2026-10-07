import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE project_coordinator_projects (
      project_id TEXT PRIMARY KEY,
      coordinator_thread_id TEXT NOT NULL UNIQUE,
      model_selection_json TEXT NOT NULL,
      context_revision INTEGER NOT NULL DEFAULT 0,
      request_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE project_coordinator_decisions (
      project_id TEXT NOT NULL REFERENCES project_coordinator_projects(project_id) ON DELETE CASCADE,
      decision_id TEXT NOT NULL,
      text TEXT NOT NULL,
      source_message_id TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, decision_id)
    )
  `;
  yield* sql`CREATE INDEX project_coordinator_decisions_order_idx
    ON project_coordinator_decisions(project_id, updated_at, decision_id)`;

  yield* sql`
    CREATE TABLE project_coordinator_requests (
      project_id TEXT NOT NULL REFERENCES project_coordinator_projects(project_id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      source_message_id TEXT NOT NULL,
      original_user_text TEXT NOT NULL,
      status TEXT NOT NULL,
      route TEXT,
      task_id TEXT,
      worker_thread_id TEXT,
      command_id TEXT,
      route_payload_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, request_id),
      UNIQUE (project_id, sequence),
      UNIQUE (project_id, source_message_id)
    )
  `;
  yield* sql`CREATE INDEX project_coordinator_requests_inbox_idx
    ON project_coordinator_requests(project_id, sequence DESC)`;
  yield* sql`CREATE INDEX project_coordinator_requests_recovery_idx
    ON project_coordinator_requests(status, project_id, sequence)`;
  yield* sql`CREATE INDEX project_coordinator_requests_worker_idx
    ON project_coordinator_requests(worker_thread_id, project_id, sequence)`;

  yield* sql`
    CREATE TABLE project_coordinator_notifications (
      project_id TEXT NOT NULL REFERENCES project_coordinator_projects(project_id) ON DELETE CASCADE,
      notification_id TEXT NOT NULL,
      task_id TEXT,
      worker_thread_id TEXT,
      source_message_id TEXT,
      runtime_request_id TEXT,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      observed_at TEXT,
      resolved_at TEXT,
      resolution_message_id TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, notification_id)
    )
  `;
  yield* sql`CREATE INDEX project_coordinator_notifications_inbox_idx
    ON project_coordinator_notifications(project_id, observed_at, created_at DESC)`;
});
