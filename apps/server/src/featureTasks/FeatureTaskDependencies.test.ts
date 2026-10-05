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
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@yantrix/shared/nodeSqliteClient";

import * as ServerConfig from "../config.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import { ChildProcessSpawner } from "effect/unstable/process";
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
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
let hostBase = "main";
let hostState = "OPEN";
let hostMergeCommit: string | null = null;
let hostHead = "";
let hostUnavailable = false;
const githubLayer = Layer.mock(GitHubCli.GitHubCli)({
  execute: ({ args }) =>
    Effect.sync(() => {
      if (hostUnavailable) throw new Error("host offline");
      return {
        exitCode: 0 as ChildProcessSpawner.ExitCode,
        stdout: encodeJson(
          args[0] === "repo"
            ? { defaultBranchRef: { name: "main" } }
            : [
                {
                  number: 1,
                  url: "https://github.com/test/calculator/pull/1",
                  state: hostState,
                  headRefName: hostHead,
                  baseRefName: hostBase,
                  isCrossRepository: false,
                  mergeCommit: hostMergeCommit ? { oid: hostMergeCommit } : null,
                },
              ],
        ),
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      };
    }).pipe(
      Effect.catchDefect(() =>
        Effect.fail(
          new GitHubCli.GitHubCliCommandError({
            command: "gh",
            cwd: "/test",
            cause: "offline",
          }),
        ),
      ),
    ),
});
const testLayer = FeatureTaskWorkspaces.layer.pipe(
  Layer.provideMerge(
    Dependencies.layer.pipe(
      Layer.provide(githubLayer),
      Layer.provide(gitDriverLayer),
      Layer.provide(FeatureTasks.layer),
    ),
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

it.layer(testLayer)("Calculator task dependencies", (it) => {
  it.effect(
    "waits across service restart, verifies a squash merge, and starts addition from the keypad commit",
    () =>
      Effect.gen(function* () {
        const { root, fs, path, sql, tasks, taskId, projectId, threadA } = yield* makeRepo();
        const workspaces = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
        const remotePath = path.join(path.dirname(root), "remote.git");
        yield* git(root, ["init", "--bare", remotePath]);
        yield* git(root, ["remote", "add", "origin", "https://github.com/test/calculator.git"]);
        yield* git(root, [
          "config",
          `url.${remotePath}.insteadOf`,
          "https://github.com/test/calculator.git",
        ]);
        yield* git(root, ["push", "origin", "main"]);
        const a = (yield* workspaces.ensure({ id: taskId })).binding!;
        hostHead = a.branch;
        hostState = "OPEN";
        hostMergeCommit = null;
        hostUnavailable = false;
        yield* fs.writeFileString(
          path.join(a.worktreePath, "calculator.html"),
          "<output>0</output><button>1</button><button>2</button>",
        );
        yield* git(a.worktreePath, ["add", "calculator.html"]);
        yield* git(a.worktreePath, ["commit", "-m", "keypad"]);
        const bId = FeatureTaskId.make(`${taskId}-addition`);
        const bInput = {
          id: bId,
          projectId,
          title: "Addition",
          objective: "Add two numbers using the keypad",
          acceptanceCriteria: ["12 + 7 = 19"],
          decisions: [],
          handoff: "",
          nextAction: "Add + and =",
          threadIds: [],
          dependencyIds: [taskId],
        };
        yield* tasks.create(bInput);
        assert.equal((yield* workspaces.inspect({ id: bId })).state, "dependencies_blocked");
        assert.equal((yield* workspaces.ensure({ id: bId })).binding, null);
        assert.deepEqual((yield* tasks.get({ id: bId })).task.dependencyIds, [taskId]);
        const aCurrent = (yield* tasks.get({ id: taskId })).task;
        const cycle = yield* tasks
          .update({
            id: taskId,
            expectedVersion: aCurrent.version,
            patch: { dependencyIds: [bId] },
          })
          .pipe(Effect.flip);
        assert.equal(cycle.code, "invalid_link");
        const duplicate = yield* tasks
          .create({
            ...bInput,
            id: FeatureTaskId.make(`${bId}-duplicate`),
            dependencyIds: [taskId, taskId],
          })
          .pipe(Effect.flip);
        assert.equal(duplicate.code, "invalid_link");
        const self = yield* tasks
          .create({
            ...bInput,
            id: FeatureTaskId.make(`${bId}-self`),
            dependencyIds: [FeatureTaskId.make(`${bId}-self`)],
          })
          .pipe(Effect.flip);
        assert.equal(self.code, "invalid_link");
        const missing = yield* tasks
          .create({
            ...bInput,
            id: FeatureTaskId.make(`${bId}-missing`),
            dependencyIds: [FeatureTaskId.make("missing")],
          })
          .pipe(Effect.flip);
        assert.equal(missing.code, "invalid_link");
        const anotherProjectId = ProjectId.make(`${projectId}-other`);
        const now = "2026-10-05T00:00:00.000Z";
        yield* sql`INSERT INTO projection_projects (project_id, title, workspace_root, scripts_json, created_at, updated_at, deleted_at)
          VALUES (${anotherProjectId}, 'Other', ${root}, '[]', ${now}, ${now}, NULL)`;
        const crossProject = yield* tasks
          .create({
            ...bInput,
            id: FeatureTaskId.make(`${bId}-cross-project`),
            projectId: anotherProjectId,
          })
          .pipe(Effect.flip);
        assert.equal(crossProject.code, "invalid_link");
        const environment = yield* Effect.context();
        const rebuiltEnvironment = yield* Layer.build(
          FeatureTaskWorkspaces.layer.pipe(Layer.provide(Layer.succeedContext(environment))),
        );
        const restarted = Context.get(
          rebuiltEnvironment,
          FeatureTaskWorkspaces.FeatureTaskWorkspaceService,
        );
        assert.equal((yield* restarted.inspect({ id: bId })).state, "dependencies_blocked");
        hostState = "CLOSED";
        assert.match(
          (yield* restarted.inspect({ id: bId })).dependencies![0]!.message,
          /closed without merging/,
        );
        hostUnavailable = true;
        assert.equal((yield* restarted.inspect({ id: bId })).dependencies![0]!.state, "unknown");
        hostUnavailable = false;
        // The local branch stays stale while a different checkout merges and pushes the keypad.
        const integration = path.join(path.dirname(root), "integration");
        yield* git(root, ["worktree", "add", "-b", "integration", integration, "main"]);
        yield* git(integration, ["merge", "--squash", a.branch]);
        yield* git(integration, ["commit", "-m", "Merge keypad"]);
        hostMergeCommit = (yield* git(integration, ["rev-parse", "HEAD"])).stdout.trim();
        yield* git(integration, ["push", "origin", "HEAD:main"]);
        hostState = "MERGED";
        hostBase = "another-branch";
        assert.equal((yield* restarted.inspect({ id: bId })).dependencies![0]!.state, "unknown");
        hostBase = "main";
        assert.equal((yield* restarted.inspect({ id: bId })).state, "unbound");
        const b = (yield* restarted.ensure({ id: bId })).binding!;
        assert.equal(
          (yield* git(b.worktreePath, ["rev-parse", "HEAD"])).stdout.trim(),
          hostMergeCommit,
        );
        assert.equal(
          (yield* git(b.worktreePath, [
            "config",
            "--get",
            `branch.${b.branch}.gh-merge-base`,
          ])).stdout.trim(),
          "main",
        );
        assert.include(
          yield* fs.readFileString(path.join(b.worktreePath, "calculator.html")),
          "<button>2</button>",
        );
        assert.notEqual((yield* git(root, ["rev-parse", "HEAD"])).stdout.trim(), hostMergeCommit);
        yield* fs.writeFileString(
          path.join(b.worktreePath, "notes.txt"),
          "valuable uncommitted work",
        );
        yield* tasks.update({
          id: bId,
          expectedVersion: (yield* tasks.get({ id: bId })).task.version,
          patch: { handoff: "The keypad is available." },
        });
        yield* restarted.assertThreadWorkspace({
          taskId: bId,
          threadId: threadA,
          worktreePath: b.worktreePath,
          branch: b.branch,
        });
        hostUnavailable = true;
        assert.equal(
          (yield* restarted
            .assertThreadWorkspace({
              taskId: bId,
              threadId: threadA,
              worktreePath: b.worktreePath,
              branch: b.branch,
            })
            .pipe(Effect.flip)).code,
          "conflict",
        );
        hostUnavailable = false;
        // An already-created checkout is never reset or silently rebased.
        const cId = FeatureTaskId.make(`${taskId}-existing`);
        yield* tasks.create({ ...bInput, id: cId, dependencyIds: [] });
        const c = (yield* restarted.ensure({ id: cId })).binding!;
        yield* fs.writeFileString(path.join(c.worktreePath, "notes.txt"), "preserve me");
        yield* tasks.update({
          id: cId,
          expectedVersion: (yield* tasks.get({ id: cId })).task.version,
          patch: { dependencyIds: [taskId] },
        });
        assert.equal(
          (yield* restarted.inspect({ id: cId })).dependencies![0]!.state,
          "integration_required",
        );
        assert.equal((yield* restarted.ensure({ id: cId })).state, "dependencies_blocked");
        assert.equal(
          yield* fs.readFileString(path.join(c.worktreePath, "notes.txt")),
          "preserve me",
        );
        yield* git(c.worktreePath, ["merge", "--ff-only", hostMergeCommit]);
        assert.equal((yield* restarted.inspect({ id: cId })).state, "ready");
        const refs = yield* git(root, ["for-each-ref", "refs/yantrix/dependency-checks"]);
        assert.equal(refs.stdout, "");
        // Persistence is not dependent on the service instance or its in-memory locks.
        const stored = yield* sql<{
          dependencyIds: string;
        }>`SELECT dependency_ids_json AS dependencyIds FROM feature_tasks WHERE task_id = ${bId}`;
        assert.equal(stored[0]!.dependencyIds, encodeJson([taskId]));
      }),
  );
});
