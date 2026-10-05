import * as NodeCrypto from "node:crypto";

import {
  FeatureTaskError,
  FeatureTaskId,
  type FeatureTaskWorkspaceBinding,
  type FeatureTaskWorkspaceResult as FeatureTaskWorkspaceResultModel,
} from "@yantrix/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as FeatureTasks from "./FeatureTaskService.ts";
import { makeKeyedSerialExecutor } from "../orchestration-v2/KeyedSerialExecutor.ts";

export class FeatureTaskWorkspaceService extends Context.Service<
  FeatureTaskWorkspaceService,
  {
    readonly inspect: (input: {
      readonly id: FeatureTaskId;
    }) => Effect.Effect<FeatureTaskWorkspaceResultModel, FeatureTaskError>;
    readonly ensure: (input: {
      readonly id: FeatureTaskId;
    }) => Effect.Effect<FeatureTaskWorkspaceResultModel, FeatureTaskError>;
    readonly attach: (input: {
      readonly id: FeatureTaskId;
      readonly worktreePath: string;
    }) => Effect.Effect<FeatureTaskWorkspaceResultModel, FeatureTaskError>;
    readonly assertThreadWorkspace: (input: {
      readonly taskId: FeatureTaskId | null;
      readonly threadId: string;
      readonly worktreePath: string | null;
      readonly branch: string | null;
    }) => Effect.Effect<void, FeatureTaskError>;
  }
>()("yantrix/featureTasks/FeatureTaskWorkspaceService") {}

const conflict = (id: FeatureTaskId, message: string) =>
  new FeatureTaskError({ code: "conflict", message, taskId: id });
const storage = (id: FeatureTaskId) =>
  new FeatureTaskError({
    code: "storage",
    message: "Feature task workspace operation failed.",
    taskId: id,
  });
const isFeatureTaskError = Schema.is(FeatureTaskError);
export const layer = Layer.effect(
  FeatureTaskWorkspaceService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const tasks = yield* FeatureTasks.FeatureTaskService;
    const git = yield* GitWorkflow.GitWorkflowService;
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const locks = yield* makeKeyedSerialExecutor<FeatureTaskId>();

    const getTask = (id: FeatureTaskId) => tasks.get({ id }).pipe(Effect.map(({ task }) => task));
    const taskThreadsMatch = Effect.fn("FeatureTaskWorkspaceService.taskThreadsMatch")(function* (
      id: FeatureTaskId,
      worktreePath: string,
      branch: string,
    ) {
      const rows = yield* sql<{
        readonly threadId: string;
        readonly worktreePath: string | null;
        readonly branch: string | null;
      }>`
        SELECT t.thread_id AS threadId,
          json_extract(p.payload_json, '$.worktreePath') AS worktreePath,
          json_extract(p.payload_json, '$.branch') AS branch
        FROM feature_task_threads t JOIN orchestration_v2_projection_threads p ON p.thread_id = t.thread_id
        WHERE t.task_id = ${id}
      `;
      return rows.every((row) => row.worktreePath === worktreePath && row.branch === branch);
    });
    const canonicalPath = (value: string, id: FeatureTaskId) =>
      fs.realPath(value).pipe(Effect.mapError(() => storage(id)));
    const canonicalRegisteredPath = (value: string, id: FeatureTaskId) =>
      fs.realPath(value).pipe(
        Effect.catch(() =>
          fs
            .realPath(path.dirname(value))
            .pipe(Effect.map((parent) => path.join(parent, path.basename(value)))),
        ),
        Effect.mapError(() => storage(id)),
      );
    const commonGitDir = (cwd: string) =>
      git.commonGitDirectory(cwd).pipe(Effect.map((value) => path.resolve(cwd, value)));
    const registeredWorktreeForBranch = (repoPath: string, branch: string) =>
      git.registeredWorktreePath({ cwd: repoPath, branch });
    const localBranchExists = (repoPath: string, branch: string) =>
      git.localBranchExists({ cwd: repoPath, branch });

    const inspectBinding: (
      id: FeatureTaskId,
      binding: FeatureTaskWorkspaceBinding,
    ) => Effect.Effect<FeatureTaskWorkspaceResultModel, FeatureTaskError> = (id, binding) =>
      Effect.gen(function* () {
        const exists = yield* fs
          .exists(binding.worktreePath)
          .pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          const [branchExists, registeredPath] = yield* Effect.all([
            localBranchExists(binding.repoPath, binding.branch),
            registeredWorktreeForBranch(binding.repoPath, binding.branch),
          ]).pipe(Effect.mapError(() => storage(id)));
          if (
            registeredPath !== null &&
            (yield* canonicalRegisteredPath(registeredPath, id)) !==
              (yield* canonicalRegisteredPath(binding.worktreePath, id))
          ) {
            return { state: "conflict" as const, binding, recoveryAvailable: false };
          }
          return { state: "missing" as const, binding, recoveryAvailable: branchExists };
        }
        const root = yield* git.gitTopLevel(binding.worktreePath).pipe(Effect.option);
        if (root._tag === "None")
          return { state: "conflict" as const, binding, recoveryAvailable: false };
        const [expectedRoot, actualRoot, expectedCommon, actualCommon, actualBranch] =
          yield* Effect.all(
            [
              canonicalPath(binding.worktreePath, id),
              canonicalPath(root.value, id),
              commonGitDir(binding.repoPath),
              commonGitDir(binding.worktreePath),
              git.checkedOutBranch(binding.worktreePath),
            ],
            { concurrency: "unbounded" },
          ).pipe(Effect.mapError((cause) => (isFeatureTaskError(cause) ? cause : storage(id))));
        if (expectedRoot !== actualRoot || expectedCommon !== actualCommon) {
          return { state: "conflict" as const, binding, recoveryAvailable: false };
        }
        if (actualBranch !== binding.branch) {
          return { state: "branch_mismatch" as const, binding, recoveryAvailable: false };
        }
        const registeredPath = yield* registeredWorktreeForBranch(
          binding.repoPath,
          binding.branch,
        ).pipe(Effect.mapError(() => storage(id)));
        if (
          registeredPath === null ||
          (yield* canonicalPath(registeredPath, id)) !== expectedRoot
        ) {
          return { state: "conflict" as const, binding, recoveryAvailable: false };
        }
        return { state: "ready" as const, binding, recoveryAvailable: true };
      }).pipe(Effect.mapError((cause) => (isFeatureTaskError(cause) ? cause : storage(id))));

    const hasActiveWorkspaceRun = (workspacePath: string) =>
      Effect.gen(function* () {
        const target = yield* canonicalRegisteredPath(
          workspacePath,
          FeatureTaskId.make("workspace-run-check"),
        );
        const rows = yield* sql<{ readonly worktreePath: string | null }>`
        SELECT DISTINCT json_extract(threads.payload_json, '$.worktreePath') AS worktreePath
        FROM orchestration_v2_projection_threads AS threads
        JOIN orchestration_v2_projection_runs AS runs ON runs.thread_id = threads.thread_id
        WHERE json_extract(threads.payload_json, '$.worktreePath') IS NOT NULL
          AND runs.status IN ('starting', 'running')
      `;
        for (const row of rows) {
          if (
            row.worktreePath !== null &&
            (yield* canonicalRegisteredPath(
              row.worktreePath,
              FeatureTaskId.make("workspace-run-check"),
            )) === target
          )
            return true;
        }
        return false;
      });

    const inspect: FeatureTaskWorkspaceService["Service"]["inspect"] = ({ id }) =>
      getTask(id).pipe(
        Effect.flatMap((task) =>
          task.workspace === undefined || task.workspace === null
            ? Effect.succeed({ state: "unbound" as const, binding: null, recoveryAvailable: true })
            : inspectBinding(id, task.workspace),
        ),
        Effect.mapError((cause) => (isFeatureTaskError(cause) ? cause : storage(id))),
      );

    const bindingFor = Effect.fn("FeatureTaskWorkspaceService.bindingFor")(function* (
      id: FeatureTaskId,
    ) {
      const task = yield* getTask(id);
      const projectRows = yield* sql<{
        readonly workspaceRoot: string;
        readonly deletedAt: string | null;
      }>`
        SELECT workspace_root AS workspaceRoot, deleted_at AS deletedAt
        FROM projection_projects WHERE project_id = ${task.projectId}
      `;
      const project = projectRows[0];
      if (!project || project.deletedAt !== null)
        return yield* conflict(id, "The task project is unavailable.");
      const repoPath = yield* canonicalPath(project.workspaceRoot, id).pipe(
        Effect.mapError(() => conflict(id, "The project repository is unavailable.")),
      );
      const configPath = path.join(
        config.worktreesDir,
        path.basename(repoPath),
        "tasks",
        NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 16),
      );
      const branch = `yantrix/task-${NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
      const createdAt = DateTime.formatIso(DateTime.toUtc(yield* DateTime.now));
      return { task, repoPath, worktreePath: configPath, branch, createdAt };
    });

    const ensure: FeatureTaskWorkspaceService["Service"]["ensure"] = Effect.fn(
      "FeatureTaskWorkspaceService.ensure",
    )(({ id }) =>
      locks.withLock(
        id,
        Effect.gen(function* () {
          const initial = yield* getTask(id);
          if (initial.archivedAt !== null)
            return yield* conflict(
              id,
              "Restore this archived task before provisioning its workspace.",
            );
          if (initial.workspace !== undefined && initial.workspace !== null) {
            const state = yield* inspectBinding(id, initial.workspace);
            if (state.state === "ready") return state;
            if (state.state !== "missing") return state;
            if (yield* hasActiveWorkspaceRun(initial.workspace.worktreePath))
              return {
                state: "conflict" as const,
                binding: initial.workspace,
                recoveryAvailable: false,
              };
            // Recreate only the registered feature path from the saved branch. Git refuses to move or
            // overwrite a branch that is active elsewhere or a non-empty path.
            const registeredPath = yield* registeredWorktreeForBranch(
              initial.workspace.repoPath,
              initial.workspace.branch,
            ).pipe(Effect.mapError(() => storage(id)));
            if (
              registeredPath !== null &&
              (yield* canonicalRegisteredPath(registeredPath, id)) !==
                (yield* canonicalRegisteredPath(initial.workspace.worktreePath, id))
            )
              return {
                state: "conflict" as const,
                binding: initial.workspace,
                recoveryAvailable: false,
              };
            if (!(yield* localBranchExists(initial.workspace.repoPath, initial.workspace.branch)))
              return {
                state: "conflict" as const,
                binding: initial.workspace,
                recoveryAvailable: false,
              };
            yield* fs
              .makeDirectory(path.dirname(initial.workspace.worktreePath), { recursive: true })
              .pipe(Effect.mapError(() => storage(id)));
            if (registeredPath !== null) {
              yield* git
                .unregisterMissingWorktree({
                  cwd: initial.workspace.repoPath,
                  path: initial.workspace.worktreePath,
                })
                .pipe(
                  Effect.mapError(() =>
                    conflict(id, "Git could not safely unregister the missing task worktree."),
                  ),
                );
              yield* git
                .createWorktree({
                  cwd: initial.workspace.repoPath,
                  refName: initial.workspace.branch,
                  path: initial.workspace.worktreePath,
                })
                .pipe(
                  Effect.mapError(() =>
                    conflict(
                      id,
                      "The saved branch cannot be restored safely after unregistering its missing worktree.",
                    ),
                  ),
                );
            } else {
              yield* git
                .createWorktree({
                  cwd: initial.workspace.repoPath,
                  refName: initial.workspace.branch,
                  path: initial.workspace.worktreePath,
                })
                .pipe(
                  Effect.mapError(() =>
                    conflict(
                      id,
                      "The saved branch cannot be restored safely. Check for an existing checkout or local changes.",
                    ),
                  ),
                );
            }
            return yield* inspectBinding(id, initial.workspace);
          }
          const candidate = yield* bindingFor(id);
          if (candidate.task.archivedAt !== null)
            return yield* conflict(
              id,
              "Restore this archived task before provisioning its workspace.",
            );
          if (!(yield* taskThreadsMatch(id, candidate.worktreePath, candidate.branch))) {
            return yield* conflict(
              id,
              "A linked conversation uses another workspace. Unlink it or attach its compatible checkout before provisioning this task.",
            );
          }
          const exists = yield* fs
            .exists(candidate.worktreePath)
            .pipe(Effect.orElseSucceed(() => false));
          if (!exists) {
            yield* fs
              .makeDirectory(path.dirname(candidate.worktreePath), { recursive: true })
              .pipe(Effect.mapError(() => storage(id)));
            const registeredPath = yield* registeredWorktreeForBranch(
              candidate.repoPath,
              candidate.branch,
            ).pipe(Effect.mapError(() => conflict(id, "The project is not a Git repository.")));
            if (
              registeredPath !== null &&
              (yield* canonicalRegisteredPath(registeredPath, id)) !==
                (yield* canonicalRegisteredPath(candidate.worktreePath, id))
            )
              return yield* conflict(
                id,
                "The task branch is already checked out in another workspace.",
              );
            if (yield* localBranchExists(candidate.repoPath, candidate.branch)) {
              if (registeredPath !== null) {
                yield* git
                  .unregisterMissingWorktree({
                    cwd: candidate.repoPath,
                    path: candidate.worktreePath,
                  })
                  .pipe(
                    Effect.mapError(() =>
                      conflict(id, "Git could not safely unregister the missing task worktree."),
                    ),
                  );
                yield* git
                  .createWorktree({
                    cwd: candidate.repoPath,
                    refName: candidate.branch,
                    path: candidate.worktreePath,
                  })
                  .pipe(
                    Effect.mapError(() =>
                      conflict(id, "The existing task branch cannot be checked out safely."),
                    ),
                  );
              } else {
                yield* git
                  .createWorktree({
                    cwd: candidate.repoPath,
                    refName: candidate.branch,
                    path: candidate.worktreePath,
                  })
                  .pipe(
                    Effect.mapError(() =>
                      conflict(id, "The existing task branch cannot be checked out safely."),
                    ),
                  );
              }
            } else {
              const baseBranch = yield* git
                .checkedOutBranch(candidate.repoPath)
                .pipe(Effect.mapError(() => conflict(id, "The project is not a Git repository.")));
              if (baseBranch === null)
                return yield* conflict(
                  id,
                  "The project has no current branch to use as the task base.",
                );
              yield* git
                .createWorktree({
                  cwd: candidate.repoPath,
                  refName: baseBranch,
                  newRefName: candidate.branch,
                  baseRefName: baseBranch,
                  path: candidate.worktreePath,
                })
                .pipe(
                  Effect.mapError(() =>
                    conflict(id, "Could not create the task branch and workspace safely."),
                  ),
                );
            }
          }
          const result = yield* inspectBinding(id, {
            repoPath: candidate.repoPath,
            worktreePath: candidate.worktreePath,
            branch: candidate.branch,
            createdAt: candidate.createdAt,
          });
          if (result.state !== "ready")
            return yield* conflict(id, "The provisioned task workspace failed its identity check.");
          const saved = yield* tasks.saveWorkspaceBinding({ id, binding: result.binding! });
          return { ...result, binding: saved.task.workspace! };
        }).pipe(
          Effect.tapError((cause) =>
            Effect.logError("Feature task workspace ensure failed", { taskId: id, cause }),
          ),
          Effect.mapError((cause) => (isFeatureTaskError(cause) ? cause : storage(id))),
        ),
      ),
    );

    const attach: FeatureTaskWorkspaceService["Service"]["attach"] = Effect.fn(
      "FeatureTaskWorkspaceService.attach",
    )(({ id, worktreePath }) =>
      locks.withLock(
        id,
        Effect.gen(function* () {
          const candidate = yield* bindingFor(id);
          if (candidate.task.archivedAt !== null)
            return yield* conflict(
              id,
              "Restore this archived task before attaching its workspace.",
            );
          const repoPath = candidate.repoPath;
          const absoluteWorktreePath = yield* canonicalPath(worktreePath, id).pipe(
            Effect.mapError(() => conflict(id, "The selected checkout is unavailable.")),
          );
          const root = yield* git
            .gitTopLevel(absoluteWorktreePath)
            .pipe(
              Effect.mapError(() => conflict(id, "The selected folder is not a Git worktree.")),
            );
          const actualRoot = yield* canonicalPath(root, id).pipe(
            Effect.mapError(() => conflict(id, "The selected worktree could not be resolved.")),
          );
          const [expectedCommon, actualCommon, actualBranch] = yield* Effect.all([
            commonGitDir(repoPath),
            commonGitDir(absoluteWorktreePath),
            git.checkedOutBranch(absoluteWorktreePath),
          ]).pipe(
            Effect.mapError(() =>
              conflict(id, "The selected checkout identity could not be verified."),
            ),
          );
          if (expectedCommon !== actualCommon || actualRoot !== absoluteWorktreePath)
            return yield* conflict(id, "The selected checkout belongs to a different repository.");
          if (absoluteWorktreePath === repoPath)
            return yield* conflict(
              id,
              "The project checkout cannot be attached as a task-owned worktree.",
            );
          if (
            yield* git
              .isPrimaryWorktree(absoluteWorktreePath)
              .pipe(
                Effect.mapError(() =>
                  conflict(id, "The selected checkout identity could not be verified."),
                ),
              )
          ) {
            return yield* conflict(
              id,
              "The repository's primary checkout cannot be attached as a task-owned worktree.",
            );
          }
          if (actualBranch === null)
            return yield* conflict(id, "The selected checkout has no branch.");
          const registeredPath = yield* registeredWorktreeForBranch(repoPath, actualBranch).pipe(
            Effect.mapError(() =>
              conflict(id, "The selected worktree registration could not be verified."),
            ),
          );
          if (
            registeredPath === null ||
            (yield* canonicalRegisteredPath(registeredPath, id)) !== absoluteWorktreePath
          )
            return yield* conflict(
              id,
              "The selected checkout is not a registered worktree for this repository.",
            );
          const existing = candidate.task.workspace;
          if (!(yield* taskThreadsMatch(id, absoluteWorktreePath, actualBranch)))
            return yield* conflict(id, "A linked conversation is active in another workspace.");
          const binding = {
            repoPath,
            worktreePath: absoluteWorktreePath,
            branch: actualBranch,
            createdAt: existing?.createdAt ?? candidate.createdAt,
          };
          if (yield* hasActiveWorkspaceRun(absoluteWorktreePath)) {
            return yield* conflict(
              id,
              "A linked conversation is running. Wait for it to stop before attaching another workspace.",
            );
          }
          const saved = yield* tasks.saveWorkspaceBinding({ id, binding });
          return {
            state: "ready" as const,
            binding: saved.task.workspace!,
            recoveryAvailable: true,
          };
        }).pipe(Effect.mapError((cause) => (isFeatureTaskError(cause) ? cause : storage(id)))),
      ),
    );

    const assertThreadWorkspace: FeatureTaskWorkspaceService["Service"]["assertThreadWorkspace"] =
      Effect.fn("FeatureTaskWorkspaceService.assertThreadWorkspace")(
        ({ taskId, threadId, worktreePath, branch }) =>
          Effect.gen(function* () {
            const linkedTask = taskId === null ? null : yield* getTask(taskId);
            const linkedBinding = linkedTask?.workspace ?? null;
            if (
              linkedBinding &&
              (worktreePath !== linkedBinding.worktreePath || branch !== linkedBinding.branch)
            ) {
              return yield* conflict(
                linkedTask!.id,
                "This conversation no longer matches its feature task workspace.",
              );
            }
            const owner = linkedBinding
              ? {
                  id: linkedTask!.id,
                  repoPath: linkedBinding.repoPath,
                  worktreePath: linkedBinding.worktreePath,
                  branch: linkedBinding.branch,
                  createdAt: linkedBinding.createdAt,
                }
              : worktreePath === null
                ? null
                : yield* Effect.gen(function* () {
                    const targetPath = yield* canonicalRegisteredPath(
                      worktreePath,
                      taskId ?? FeatureTaskId.make("workspace-owner-check"),
                    );
                    const bindings = yield* sql<{
                      readonly id: FeatureTaskId;
                      readonly repoPath: string;
                      readonly worktreePath: string;
                      readonly branch: string;
                      readonly createdAt: string;
                    }>`
                SELECT task_id AS id, workspace_repo_path AS repoPath, workspace_worktree_path AS worktreePath,
                  workspace_branch AS branch, workspace_created_at AS createdAt
                FROM feature_tasks WHERE workspace_worktree_path IS NOT NULL
              `;
                    for (const candidate of bindings) {
                      if (
                        (yield* canonicalRegisteredPath(candidate.worktreePath, candidate.id)) ===
                        targetPath
                      )
                        return candidate;
                    }
                    return null;
                  });
            if (owner === null) return;
            if (linkedTask !== null && linkedTask.id !== owner.id) {
              return yield* conflict(taskId!, "This checkout belongs to another feature task.");
            }
            const binding: FeatureTaskWorkspaceBinding = {
              repoPath: owner.repoPath,
              worktreePath: owner.worktreePath,
              branch: owner.branch,
              createdAt: owner.createdAt,
            };
            if (worktreePath !== binding.worktreePath || branch !== binding.branch) {
              return yield* conflict(
                owner.id,
                "This conversation no longer matches its feature task workspace.",
              );
            }
            const otherActiveThreads = yield* sql<{
              readonly threadId: string;
              readonly worktreePath: string | null;
            }>`
          SELECT DISTINCT threads.thread_id AS threadId,
            json_extract(threads.payload_json, '$.worktreePath') AS worktreePath
          FROM orchestration_v2_projection_threads AS threads
          JOIN orchestration_v2_projection_runs AS runs ON runs.thread_id = threads.thread_id
          WHERE threads.thread_id <> ${threadId} AND runs.status IN ('starting', 'running')
        `;
            const canonicalBindingPath = yield* canonicalRegisteredPath(
              binding.worktreePath,
              owner.id,
            );
            for (const active of otherActiveThreads) {
              if (
                active.worktreePath !== null &&
                (yield* canonicalRegisteredPath(active.worktreePath, owner.id)) ===
                  canonicalBindingPath
              ) {
                return yield* conflict(
                  owner.id,
                  "Another conversation is already active in this task workspace.",
                );
              }
            }
            const state = yield* inspectBinding(owner.id, binding);
            if (state.state !== "ready")
              return yield* conflict(
                owner.id,
                "The feature task workspace needs recovery before agent work can continue.",
              );
          }).pipe(
            Effect.mapError((cause) =>
              isFeatureTaskError(cause) ? cause : storage(taskId ?? FeatureTaskId.make("unknown")),
            ),
          ),
      );

    return FeatureTaskWorkspaceService.of({ inspect, ensure, attach, assertThreadWorkspace });
  }),
);
