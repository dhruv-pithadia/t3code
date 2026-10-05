import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE feature_tasks ADD COLUMN workspace_repo_path TEXT`;
  yield* sql`ALTER TABLE feature_tasks ADD COLUMN workspace_worktree_path TEXT`;
  yield* sql`ALTER TABLE feature_tasks ADD COLUMN workspace_branch TEXT`;
  yield* sql`ALTER TABLE feature_tasks ADD COLUMN workspace_created_at TEXT`;
  yield* sql`CREATE UNIQUE INDEX feature_tasks_workspace_worktree_unique
    ON feature_tasks(workspace_worktree_path) WHERE workspace_worktree_path IS NOT NULL`;
  yield* sql`CREATE UNIQUE INDEX feature_tasks_workspace_repo_branch_unique
    ON feature_tasks(workspace_repo_path, workspace_branch)
    WHERE workspace_repo_path IS NOT NULL AND workspace_branch IS NOT NULL`;
});
