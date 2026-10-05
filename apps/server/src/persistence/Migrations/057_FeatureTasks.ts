import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE feature_tasks (
      task_id TEXT PRIMARY KEY,
      create_payload_json TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      acceptance_criteria_json TEXT NOT NULL,
      decisions_json TEXT NOT NULL,
      next_action TEXT NOT NULL,
      handoff TEXT NOT NULL,
      status TEXT NOT NULL,
      archived_at TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX feature_tasks_project_updated_idx
    ON feature_tasks(project_id, archived_at, updated_at DESC, task_id)
  `;
  yield* sql`
    CREATE TABLE feature_task_threads (
      thread_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES feature_tasks(task_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      UNIQUE(task_id, position)
    )
  `;
  yield* sql`CREATE INDEX feature_task_threads_task_idx ON feature_task_threads(task_id, position)`;
});
