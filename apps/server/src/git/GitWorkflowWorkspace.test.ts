import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as GitManager from "./GitManager.ts";
import * as GitWorkflow from "./GitWorkflowService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";

const platformLayer = NodeServices.layer;
const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "git-workflow-workspace-test-",
}).pipe(Layer.provide(platformLayer));
const vcsProcessLayer = VcsProcess.layer.pipe(Layer.provideMerge(platformLayer));
const gitVcsDriverLayer = GitVcsDriver.layer.pipe(
  Layer.provideMerge(vcsProcessLayer),
  Layer.provideMerge(configLayer),
  Layer.provideMerge(platformLayer),
);
const vcsDriverRegistryLayer = VcsDriverRegistry.layer.pipe(
  Layer.provideMerge(vcsProcessLayer),
  Layer.provideMerge(platformLayer),
);
const gitManagerLayer = Layer.mock(GitManager.GitManager)({
  localStatus: () =>
    Effect.succeed({
      isRepo: true,
      hasPrimaryRemote: false,
      isDefaultRef: false,
      refName: "main",
      hasWorkingTreeChanges: false,
      workingTree: { files: [], insertions: 0, deletions: 0 },
    }),
});
const gitWorkflowLayer = GitWorkflow.layer.pipe(
  Layer.provideMerge(gitVcsDriverLayer),
  Layer.provideMerge(vcsDriverRegistryLayer),
  Layer.provide(gitManagerLayer),
);

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    return yield* git.execute({
      operation: "GitWorkflowWorkspaceTest.git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
  });

const makeRepository = Effect.fn("GitWorkflowWorkspaceTest.makeRepository")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "git-workflow-workspace-" });
  yield* fs.writeFileString(path.join(root, "README.md"), "initial\n");
  yield* runGit(root, ["init", "-b", "main"]);
  yield* runGit(root, ["config", "user.name", "Workspace Test"]);
  yield* runGit(root, ["config", "user.email", "workspace-test@example.test"]);
  yield* runGit(root, ["add", "README.md"]);
  yield* runGit(root, ["commit", "-m", "initial"]);
  return { fs, path, root };
});

it.layer(gitWorkflowLayer)("GitWorkflowService worktree operations", (it) => {
  it.effect("reads the checked-out branch from Git rather than stale local status", () =>
    Effect.gen(function* () {
      const { root } = yield* makeRepository();
      const workflow = yield* GitWorkflow.GitWorkflowService;

      yield* runGit(root, ["switch", "-c", "feature/current-checkout"]);
      assert.equal((yield* workflow.localStatus({ cwd: root })).refName, "main");
      assert.equal(yield* workflow.checkedOutBranch(root), "feature/current-checkout");

      yield* runGit(root, ["switch", "--detach"]);
      assert.isNull(yield* workflow.checkedOutBranch(root));
    }).pipe(Effect.scoped),
  );

  it.effect("parses a Unicode and space-containing worktree path through Git porcelain", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* makeRepository();
      const workflow = yield* GitWorkflow.GitWorkflowService;
      const checkout = path.join(root, "task worktree 雪");
      yield* workflow.createWorktree({
        cwd: root,
        path: checkout,
        refName: "main",
        newRefName: "feature/unicode-path",
        baseRefName: "main",
      });

      assert.equal(
        yield* workflow.registeredWorktreePath({ cwd: root, branch: "feature/unicode-path" }),
        yield* fs.realPath(checkout),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("rejects ambiguous same-branch worktree registrations", () =>
    Effect.gen(function* () {
      const { path, root } = yield* makeRepository();
      const workflow = yield* GitWorkflow.GitWorkflowService;
      const first = path.join(root, "first checkout");
      const second = path.join(root, "second checkout");
      yield* workflow.createWorktree({
        cwd: root,
        path: first,
        refName: "main",
        newRefName: "feature/duplicate",
        baseRefName: "main",
      });
      yield* runGit(root, ["worktree", "add", "--force", second, "feature/duplicate"]);

      const result = yield* Effect.result(
        workflow.registeredWorktreePath({ cwd: root, branch: "feature/duplicate" }),
      );
      assert.isTrue(result._tag === "Failure");
    }).pipe(Effect.scoped),
  );

  it.effect("looks up an exact local branch after many unrelated refs", () =>
    Effect.gen(function* () {
      const { root } = yield* makeRepository();
      const workflow = yield* GitWorkflow.GitWorkflowService;
      for (let index = 0; index < 48; index++) {
        yield* runGit(root, ["branch", `unrelated-${index}`]);
      }
      yield* runGit(root, ["branch", "feature/exact-target"]);

      assert.isTrue(
        yield* workflow.localBranchExists({ cwd: root, branch: "feature/exact-target" }),
      );
      assert.isFalse(
        yield* workflow.localBranchExists({ cwd: root, branch: "feature/exact-target-extra" }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "unregisters only the selected missing worktree and preserves unrelated registrations",
    () =>
      Effect.gen(function* () {
        const { fs, path, root } = yield* makeRepository();
        const workflow = yield* GitWorkflow.GitWorkflowService;
        const missingPath = path.join(root, "missing checkout");
        const unrelatedPath = path.join(root, "unrelated checkout");
        yield* workflow.createWorktree({
          cwd: root,
          path: missingPath,
          refName: "main",
          newRefName: "feature/missing",
          baseRefName: "main",
        });
        yield* workflow.createWorktree({
          cwd: root,
          path: unrelatedPath,
          refName: "main",
          newRefName: "feature/unrelated",
          baseRefName: "main",
        });
        yield* fs.remove(missingPath, { recursive: true });

        yield* workflow.unregisterMissingWorktree({ cwd: root, path: missingPath });

        assert.isNull(
          yield* workflow.registeredWorktreePath({ cwd: root, branch: "feature/missing" }),
        );
        assert.equal(
          yield* workflow.registeredWorktreePath({ cwd: root, branch: "feature/unrelated" }),
          yield* fs.realPath(unrelatedPath),
        );
      }).pipe(Effect.scoped),
  );
});
