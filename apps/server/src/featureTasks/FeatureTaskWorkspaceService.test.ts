import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  FeatureTaskId,
  GitManagerError,
  ProjectId,
  ThreadId,
  type VcsStatusLocalResult,
} from "@yantrix/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@yantrix/shared/nodeSqliteClient";

import * as ServerConfig from "../config.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as Dependencies from "./FeatureTaskDependencyService.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";
import * as FeatureTaskWorkspaces from "./FeatureTaskWorkspaceService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as GitManager from "../git/GitManager.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "feature-task-workspace-service-",
}).pipe(Layer.provide(NodeServices.layer));
const gitDriverLayer = GitVcsDriver.layer.pipe(
  Layer.provide(configLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const vcsRegistryLayer = VcsDriverRegistry.layer.pipe(
  Layer.provide(configLayer),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(NodeServices.layer),
);
const cachedLocalStatuses = new Map<string, VcsStatusLocalResult>();
const gitManagerLayer = Layer.mock(GitManager.GitManager)({
  localStatus: ({ cwd }) =>
    Effect.gen(function* () {
      const cached = cachedLocalStatuses.get(cwd);
      if (cached) return cached;
      const git = yield* GitVcsDriver.GitVcsDriver;
      const details = yield* git.statusDetails(cwd);
      const status = {
        isRepo: true,
        hasPrimaryRemote: false,
        isDefaultRef: false,
        refName: details.branch,
        hasWorkingTreeChanges: details.hasWorkingTreeChanges,
        workingTree: { files: [], insertions: 0, deletions: 0 },
      } satisfies VcsStatusLocalResult;
      cachedLocalStatuses.set(cwd, status);
      return status;
    }).pipe(
      Effect.provide(gitDriverLayer),
      Effect.mapError(
        (cause) =>
          new GitManagerError({
            operation: "FeatureTaskWorkspaceService.test.localStatus",
            cwd,
            detail: "Could not read the local test repository status.",
            cause,
          }),
      ),
    ),
});
const gitWorkflowLayer = GitWorkflowService.layer.pipe(
  Layer.provideMerge(vcsRegistryLayer),
  Layer.provideMerge(gitManagerLayer),
  Layer.provideMerge(gitDriverLayer),
);
const baseLayer = Layer.mergeAll(
  gitDriverLayer,
  gitWorkflowLayer,
  NodeSqliteClient.layer({ filename: ":memory:" }),
  NodeServices.layer,
  configLayer,
);
const testLayer = FeatureTaskWorkspaces.layer.pipe(
  Layer.provideMerge(
    Layer.succeed(Dependencies.FeatureTaskDependencyService, {
      check: () => Effect.succeed({ dependencies: [], baseCommit: null, baseBranch: null }),
    }),
  ),
  Layer.provideMerge(FeatureTasks.layer),
  Layer.provideMerge(baseLayer),
);

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const driver = yield* GitVcsDriver.GitVcsDriver;
    return yield* driver.execute({
      operation: "FeatureTaskWorkspaceService.test",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

const seed = Effect.fn("FeatureTaskWorkspaceServiceTest.seed")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const tasks = yield* FeatureTasks.FeatureTaskService;
  const fixtureKey = path.basename(path.dirname(root));
  const projectId = ProjectId.make(`project:${fixtureKey}`);
  const taskId = FeatureTaskId.make(`feature-task:${fixtureKey}`);
  const threadA = ThreadId.make(`thread:${fixtureKey}-a`);
  const threadB = ThreadId.make(`thread:${fixtureKey}-b`);
  yield* runMigrations();
  const now = "2026-10-05T00:00:00.000Z";
  yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
    VALUES (${projectId}, 'Workspace', ${root}, '[]', ${now}, ${now}, NULL)`;
  for (const id of [threadA, threadB]) {
    yield* sql`INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
      active_provider_thread_id, created_at, updated_at, archived_at, deleted_at, payload_json
    ) VALUES (${id}, ${projectId}, 'Conversation', 'codex', 'full-access', 'default', NULL,
      ${now}, ${now}, NULL, NULL, '{}')`;
  }
  yield* fs.writeFileString(path.join(root, "README.md"), "initial\n");
  yield* git(root, ["init", "-b", "main"]);
  yield* git(root, ["config", "user.name", "Workspace Test"]);
  yield* git(root, ["config", "user.email", "workspace-test@example.test"]);
  yield* git(root, ["add", "README.md"]);
  yield* git(root, ["commit", "-m", "initial"]);
  yield* tasks.create({
    id: taskId,
    projectId,
    title: "Workspace task",
    objective: "Keep task work isolated and recoverable.",
    acceptanceCriteria: ["Workspace is task-owned."],
    decisions: [],
    nextAction: "Implement safely.",
    handoff: "Resume in the task workspace.",
    threadIds: [],
  });
  return { fs, path, sql, tasks, root, projectId, taskId, threadA, threadB };
});

const makeRepo = Effect.fn("FeatureTaskWorkspaceServiceTest.makeRepo")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const container = yield* fs.makeTempDirectoryScoped({ prefix: "feature-task-workspace-repo-" });
  const root = path.join(container, "repo");
  yield* fs.makeDirectory(root);
  return yield* seed(root);
});

it.layer(testLayer)("FeatureTaskWorkspaceService", (it) => {
  it.effect(
    "creates and persists a task worktree, coalesces retries, and recovers a missing checkout without losing branch commits",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, tasks, sql, taskId, threadA } = yield* makeRepo();
        const service = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        assert.equal(yield* workflow.commonGitDirectory(root), ".git");
        assert.equal((yield* workflow.localStatus({ cwd: root })).refName, "main");
        assert.isFalse(
          yield* workflow.localBranchExists({
            cwd: root,
            branch: "feature-task-branch-does-not-exist",
          }),
        );
        // Many unrelated refs ensure task branch lookup is exact and independent of Git output limits.
        for (let n = 0; n < 36; n++) yield* git(root, ["branch", `unrelated-${n}`]);
        const [first, concurrent] = yield* Effect.all(
          [service.ensure({ id: taskId }), service.ensure({ id: taskId })],
          { concurrency: 2 },
        );
        assert.equal(first.state, "ready");
        assert.deepEqual(concurrent.binding, first.binding);
        assert.equal((yield* service.inspect({ id: taskId })).state, "ready");
        const binding = first.binding!;
        assert.notEqual(binding.worktreePath, root);
        assert.equal(
          (yield* git(binding.worktreePath, ["branch", "--show-current"])).stdout.trim(),
          binding.branch,
        );
        const featureFile = path.join(binding.worktreePath, "work.txt");
        yield* fs.writeFileString(featureFile, "valuable task work\n");
        yield* git(binding.worktreePath, ["add", "work.txt"]);
        yield* git(binding.worktreePath, ["commit", "-m", "task progress"]);
        const headBefore = (yield* git(binding.worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
        const now = "2026-10-05T00:00:00.000Z";
        yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json =
        json_set(payload_json, '$.worktreePath', ${binding.worktreePath}, '$.branch', ${binding.branch})
        WHERE thread_id = ${threadA}`;
        yield* tasks.update({ id: taskId, expectedVersion: 2, patch: { threadIds: [threadA] } });
        yield* sql`INSERT INTO orchestration_v2_projection_runs
        (run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json)
        VALUES (${`run-active-${threadA}`}, ${threadA}, 1, 'codex', NULL, 'starting', ${now}, NULL, '{}')`;

        // Rebuild the workspace service with the same persisted dependencies, but a fresh lock set.
        const environment = yield* Effect.context();
        const rebuiltEnvironment = yield* Layer.build(
          FeatureTaskWorkspaces.layer.pipe(Layer.provide(Layer.succeedContext(environment))),
        );
        const rebuilt = Context.get(
          rebuiltEnvironment,
          FeatureTaskWorkspaces.FeatureTaskWorkspaceService,
        );
        assert.equal((yield* rebuilt.inspect({ id: taskId })).state, "ready");
        const diskPath = binding.worktreePath;
        yield* fs.remove(diskPath, { recursive: true });
        assert.equal((yield* service.inspect({ id: taskId })).state, "missing");
        const blockedRecovery = yield* service.ensure({ id: taskId });
        assert.equal(blockedRecovery.state, "conflict");
        assert.isFalse(blockedRecovery.recoveryAvailable);
        assert.equal(
          (yield* git(root, ["show", `${binding.branch}:work.txt`])).stdout,
          "valuable task work\n",
        );
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE thread_id = ${threadA}`;
        const recovered = yield* service.ensure({ id: taskId });
        assert.equal(recovered.state, "ready");
        assert.equal((yield* git(diskPath, ["rev-parse", "HEAD"])).stdout.trim(), headBefore);
        assert.equal(
          yield* fs.readFileString(path.join(diskPath, "work.txt")),
          "valuable task work\n",
        );
        assert.deepEqual((yield* tasks.get({ id: taskId })).task.workspace, binding);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "rejects unsafe or foreign attachments and requires unlink before changing an established binding",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, sql, tasks, taskId, threadA, projectId } = yield* makeRepo();
        const service = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const ensure = yield* service.ensure({ id: taskId });
        assert.equal(ensure.state, "ready");
        yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.worktreePath', ${ensure.binding!.worktreePath}, '$.branch', ${ensure.binding!.branch}) WHERE thread_id = ${threadA}`;
        yield* tasks.update({ id: taskId, expectedVersion: 2, patch: { threadIds: [threadA] } });
        const mainAttach = yield* Effect.result(service.attach({ id: taskId, worktreePath: root }));
        assert.isTrue(Result.isFailure(mainAttach));

        const otherRoot = yield* fs.makeTempDirectoryScoped({
          prefix: "feature-task-foreign-repo-",
        });
        yield* fs.writeFileString(path.join(otherRoot, "README.md"), "foreign\n");
        yield* git(otherRoot, ["init", "-b", "foreign"]);
        yield* git(otherRoot, ["config", "user.name", "Workspace Test"]);
        yield* git(otherRoot, ["config", "user.email", "workspace-test@example.test"]);
        yield* git(otherRoot, ["add", "."]);
        yield* git(otherRoot, ["commit", "-m", "foreign"]);
        const foreignAttach = yield* Effect.result(
          service.attach({ id: taskId, worktreePath: otherRoot }),
        );
        assert.isTrue(Result.isFailure(foreignAttach));

        const candidate = path.join(path.dirname(root), "compatible-checkout");
        yield* git(root, ["worktree", "add", "-b", "compatible", candidate, "main"]);
        const attach = yield* Effect.result(
          service.attach({ id: taskId, worktreePath: candidate }),
        );
        assert.isTrue(Result.isFailure(attach)); // Linked conversation remains pinned to the saved workspace.
        const before = (yield* tasks.get({ id: taskId })).task.workspace!;
        assert.notEqual(before.worktreePath, candidate);
        yield* tasks.update({ id: taskId, expectedVersion: 3, patch: { threadIds: [] } });
        const attached = yield* service.attach({ id: taskId, worktreePath: candidate });
        assert.equal(attached.state, "ready");
        assert.equal(
          yield* fs.realPath(attached.binding!.worktreePath),
          yield* fs.realPath(candidate),
        );
        yield* tasks.update({ id: taskId, expectedVersion: 5, patch: { archived: true } });
        const secondTaskId = FeatureTaskId.make(`feature-task:second-${projectId}`);
        yield* tasks.create({
          id: secondTaskId,
          projectId,
          title: "Second workspace task",
          objective: "Do not share another task's workspace.",
          acceptanceCriteria: ["Workspace ownership is exclusive."],
          decisions: [],
          nextAction: "Stay isolated.",
          handoff: "Use a task-specific checkout.",
          threadIds: [],
        });
        const secondTaskAttach = yield* Effect.result(
          service.attach({ id: secondTaskId, worktreePath: candidate }),
        );
        assert.isTrue(Result.isFailure(secondTaskAttach));
        assert.isTrue(yield* fs.exists(candidate));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "rejects the repository's primary checkout when the project root is a linked worktree",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, sql, taskId, projectId } = yield* makeRepo();
        const service = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const projectRoot = path.join(path.dirname(root), "project-linked-checkout");
        yield* git(root, ["worktree", "add", "-b", "project-linked", projectRoot, "main"]);
        yield* sql`UPDATE projection_projects SET workspace_root = ${projectRoot} WHERE project_id = ${projectId}`;
        const primaryAttach = yield* Effect.result(
          service.attach({ id: taskId, worktreePath: root }),
        );
        assert.isTrue(Result.isFailure(primaryAttach));
        assert.equal(yield* fs.readFileString(path.join(root, "README.md")), "initial\n");
        assert.equal((yield* service.inspect({ id: taskId })).state, "unbound");
      }).pipe(Effect.scoped),
  );

  it.effect(
    "rejects branch or repository identity changes, mismatched linked-thread workspaces, and archived tasks",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, sql, tasks, taskId, threadA } = yield* makeRepo();
        const service = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const workflow = yield* GitWorkflowService.GitWorkflowService;
        const binding = (yield* service.ensure({ id: taskId })).binding!;
        yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.worktreePath', ${binding.worktreePath}, '$.branch', ${binding.branch}) WHERE thread_id = ${threadA}`;
        yield* tasks.update({ id: taskId, expectedVersion: 2, patch: { threadIds: [threadA] } });
        yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.worktreePath', ${binding.worktreePath}, '$.branch', 'wrong-branch') WHERE thread_id = ${threadA}`;
        const branchLink = yield* Effect.result(
          service.assertThreadWorkspace({
            taskId,
            threadId: threadA,
            worktreePath: binding.worktreePath,
            branch: "wrong-branch",
          }),
        );
        assert.isTrue(Result.isFailure(branchLink));
        yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.worktreePath', ${binding.worktreePath}, '$.branch', ${binding.branch}) WHERE thread_id = ${threadA}`;

        // Prime the GitManager status cache, then change the checkout's live branch. Workspace
        // inspection must read the actual checkout branch instead of accepting that stale status.
        assert.equal(
          (yield* workflow.localStatus({ cwd: binding.worktreePath })).refName,
          binding.branch,
        );
        yield* git(binding.worktreePath, ["switch", "-c", "unexpected-live-branch"]);
        assert.equal(
          (yield* workflow.localStatus({ cwd: binding.worktreePath })).refName,
          binding.branch,
        );
        assert.equal((yield* service.inspect({ id: taskId })).state, "branch_mismatch");
        yield* git(binding.worktreePath, ["switch", binding.branch]);
        assert.equal((yield* service.inspect({ id: taskId })).state, "ready");

        // A different repository checked out at the same branch name is still foreign.
        const other = yield* fs.makeTempDirectoryScoped({
          prefix: "feature-task-same-branch-foreign-",
        });
        yield* fs.writeFileString(path.join(other, "README.md"), "other\n");
        yield* git(other, ["init", "-b", "foreign-main"]);
        yield* git(other, ["config", "user.name", "Workspace Test"]);
        yield* git(other, ["config", "user.email", "workspace-test@example.test"]);
        yield* git(other, ["add", "."]);
        yield* git(other, ["commit", "-m", "other"]);
        yield* git(other, ["branch", binding.branch]);
        yield* fs.remove(binding.worktreePath, { recursive: true });
        yield* fs.makeDirectory(path.dirname(binding.worktreePath), { recursive: true });
        yield* git(root, ["worktree", "prune"]);
        yield* git(other, ["worktree", "add", binding.worktreePath, binding.branch]);
        assert.equal((yield* service.inspect({ id: taskId })).state, "conflict");

        yield* tasks.update({
          id: taskId,
          expectedVersion: 3,
          patch: { threadIds: [], archived: true },
        });
        const archivedEnsure = yield* Effect.result(service.ensure({ id: taskId }));
        assert.isTrue(Result.isFailure(archivedEnsure));
        const archivedAttach = yield* Effect.result(
          service.attach({ id: taskId, worktreePath: root }),
        );
        assert.isTrue(Result.isFailure(archivedAttach));
      }).pipe(Effect.scoped),
  );

  it.effect(
    "requires unlink to rebind, rejects threads linked to another task, and blocks parallel active turns",
    () =>
      Effect.gen(function* () {
        const { fs, path, root, sql, tasks, taskId, threadA, threadB } = yield* makeRepo();
        const service = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const binding = (yield* service.ensure({ id: taskId })).binding!;
        const now = "2026-10-05T00:00:00.000Z";
        for (const id of [threadA, threadB]) {
          yield* sql`UPDATE orchestration_v2_projection_threads SET payload_json = json_set(payload_json, '$.worktreePath', ${binding.worktreePath}, '$.branch', ${binding.branch}) WHERE thread_id = ${id}`;
        }
        yield* tasks.update({
          id: taskId,
          expectedVersion: 2,
          patch: { threadIds: [threadA, threadB] },
        });
        yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json)
        VALUES ('run-a', ${threadA}, 1, 'codex', NULL, 'running', ${now}, NULL, '{}')`;
        const parallelStart = yield* Effect.result(
          service.assertThreadWorkspace({
            taskId,
            threadId: threadB,
            worktreePath: binding.worktreePath,
            branch: binding.branch,
          }),
        );
        assert.isTrue(Result.isFailure(parallelStart));
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run-a'`;
        yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json)
        VALUES ('run-b', ${threadB}, 1, 'codex', NULL, 'starting', ${now}, NULL, '{}')`;
        const parallelRunning = yield* Effect.result(
          service.assertThreadWorkspace({
            taskId,
            threadId: threadA,
            worktreePath: binding.worktreePath,
            branch: binding.branch,
          }),
        );
        assert.isTrue(Result.isFailure(parallelRunning));
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run-b'`;
        yield* tasks.update({ id: taskId, expectedVersion: 3, patch: { threadIds: [threadA] } });
        yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, provider_thread_id, status, requested_at, completed_at, payload_json)
        VALUES ('run-unlinked', ${threadB}, 2, 'codex', NULL, 'running', ${now}, NULL, '{}')`;
        const unlinkedActive = yield* Effect.result(
          service.assertThreadWorkspace({
            taskId: null,
            threadId: threadA,
            worktreePath: binding.worktreePath,
            branch: binding.branch,
          }),
        );
        assert.isTrue(Result.isFailure(unlinkedActive));
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run-unlinked'`;
        yield* service.assertThreadWorkspace({
          taskId,
          threadId: threadA,
          worktreePath: binding.worktreePath,
          branch: binding.branch,
        });

        const alternative = path.join(path.dirname(root), "attachable-worktree");
        yield* git(root, ["worktree", "add", "-b", "alternative", alternative, "main"]);
        const attachBlocked = yield* Effect.result(
          service.attach({ id: taskId, worktreePath: alternative }),
        );
        assert.isTrue(Result.isFailure(attachBlocked)); // Linked conversations remain pinned to the saved workspace.
        assert.equal(
          (yield* tasks.get({ id: taskId })).task.workspace?.worktreePath,
          binding.worktreePath,
        );
        yield* tasks.update({ id: taskId, expectedVersion: 4, patch: { threadIds: [] } });
        const rebound = yield* service.attach({ id: taskId, worktreePath: alternative });
        assert.equal(rebound.state, "ready");
        assert.equal(
          yield* fs.realPath(rebound.binding!.worktreePath),
          yield* fs.realPath(alternative),
        );
        assert.isTrue(yield* fs.exists(alternative)); // Rebinding never deletes another checkout.
      }).pipe(Effect.scoped),
  );
});
