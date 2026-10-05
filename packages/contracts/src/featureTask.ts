import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

const BoundedName = TrimmedNonEmptyString.check(Schema.isMaxLength(240));
const TaskText = Schema.String.check(Schema.isMaxLength(32_000));
const ObjectiveText = TrimmedNonEmptyString.check(Schema.isMaxLength(32_000));
const ListItem = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));
const TaskList = Schema.Array(ListItem).check(Schema.isMaxLength(100));
const TaskThreadIds = Schema.Array(ThreadId).check(Schema.isMaxLength(100));

export const FeatureTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(160)).pipe(
  Schema.brand("FeatureTaskId"),
);
export type FeatureTaskId = typeof FeatureTaskId.Type;

export const FeatureTaskStatus = Schema.Literals([
  "requested",
  "planning",
  "building",
  "verifying",
  "ready_for_review",
  "paused",
  "blocked",
]);
export type FeatureTaskStatus = typeof FeatureTaskStatus.Type;

/** The stable filesystem and branch identity provisioned for a feature task. */
export const FeatureTaskWorkspaceBinding = Schema.Struct({
  repoPath: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type FeatureTaskWorkspaceBinding = typeof FeatureTaskWorkspaceBinding.Type;

export const FeatureTaskWorkspaceState = Schema.Literals([
  "unbound",
  "ready",
  "missing",
  "branch_mismatch",
  "conflict",
  "dependencies_blocked",
]);
export type FeatureTaskWorkspaceState = typeof FeatureTaskWorkspaceState.Type;

export const FeatureTaskDependencyCheck = Schema.Struct({
  id: FeatureTaskId,
  title: Schema.String,
  state: Schema.Literals(["waiting", "merged", "unknown", "integration_required"]),
  message: Schema.String,
  pullRequestUrl: Schema.NullOr(Schema.String),
});
export type FeatureTaskDependencyCheck = typeof FeatureTaskDependencyCheck.Type;

export const FeatureTaskWorkspaceResult = Schema.Struct({
  dependencies: Schema.optional(Schema.Array(FeatureTaskDependencyCheck)),
  state: FeatureTaskWorkspaceState,
  binding: Schema.NullOr(FeatureTaskWorkspaceBinding),
  recoveryAvailable: Schema.Boolean,
});
export type FeatureTaskWorkspaceResult = typeof FeatureTaskWorkspaceResult.Type;

export const FeatureTaskDelivery = Schema.Struct({
  pullRequest: Schema.NullOr(
    Schema.Struct({
      number: NonNegativeInt,
      title: Schema.String,
      url: Schema.String,
      state: Schema.Literals(["open", "closed", "merged"]),
      headBranch: Schema.String,
      baseBranch: Schema.String,
    }),
  ),
  checks: Schema.Literals(["unknown", "pending", "passing", "failing"]),
  mergeState: Schema.Literals(["unknown", "open", "merged", "closed"]),
  updatedAt: Schema.NullOr(IsoDateTime),
});
export type FeatureTaskDelivery = typeof FeatureTaskDelivery.Type;

export const FeatureTask = Schema.Struct({
  id: FeatureTaskId,
  projectId: ProjectId,
  title: BoundedName,
  objective: ObjectiveText,
  acceptanceCriteria: TaskList,
  decisions: TaskList,
  nextAction: TaskText,
  handoff: TaskText,
  status: FeatureTaskStatus,
  /** Optional for wire compatibility with servers predating task workspaces. */
  workspace: Schema.optional(Schema.NullOr(FeatureTaskWorkspaceBinding)),
  dependencyIds: Schema.optional(Schema.Array(FeatureTaskId).check(Schema.isMaxLength(20))),
  threadIds: TaskThreadIds,
  archivedAt: Schema.NullOr(IsoDateTime),
  version: NonNegativeInt.check(Schema.isGreaterThanOrEqualTo(1)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FeatureTask = typeof FeatureTask.Type;

export const FeatureTaskPatch = Schema.Struct({
  title: Schema.optional(BoundedName),
  objective: Schema.optional(ObjectiveText),
  acceptanceCriteria: Schema.optional(TaskList),
  decisions: Schema.optional(TaskList),
  nextAction: Schema.optional(TaskText),
  handoff: Schema.optional(TaskText),
  status: Schema.optional(FeatureTaskStatus),
  dependencyIds: Schema.optional(Schema.Array(FeatureTaskId).check(Schema.isMaxLength(20))),
  threadIds: Schema.optional(TaskThreadIds),
  archived: Schema.optional(Schema.Boolean),
});
export type FeatureTaskPatch = typeof FeatureTaskPatch.Type;

export const FeatureTaskListInput = Schema.Struct({ projectId: Schema.optional(ProjectId) });
export type FeatureTaskListInput = typeof FeatureTaskListInput.Type;
export const FeatureTaskListResult = Schema.Struct({ tasks: Schema.Array(FeatureTask) });
export type FeatureTaskListResult = typeof FeatureTaskListResult.Type;
export const FeatureTaskGetInput = Schema.Struct({ id: FeatureTaskId });
export type FeatureTaskGetInput = typeof FeatureTaskGetInput.Type;
export const FeatureTaskGetResult = Schema.Struct({ task: FeatureTask });
export type FeatureTaskGetResult = typeof FeatureTaskGetResult.Type;
export const FeatureTaskCreateInput = Schema.Struct({
  id: FeatureTaskId,
  projectId: ProjectId,
  title: BoundedName,
  objective: ObjectiveText,
  acceptanceCriteria: TaskList,
  decisions: TaskList,
  nextAction: TaskText,
  handoff: TaskText,
  dependencyIds: Schema.optional(Schema.Array(FeatureTaskId).check(Schema.isMaxLength(20))),
  threadIds: TaskThreadIds,
});
export type FeatureTaskCreateInput = typeof FeatureTaskCreateInput.Type;
export const FeatureTaskUpdateInput = Schema.Struct({
  id: FeatureTaskId,
  expectedVersion: NonNegativeInt.check(Schema.isGreaterThanOrEqualTo(1)),
  patch: FeatureTaskPatch,
});
export type FeatureTaskUpdateInput = typeof FeatureTaskUpdateInput.Type;

export const FeatureTaskWorkspaceInput = Schema.Struct({ id: FeatureTaskId });
export type FeatureTaskWorkspaceInput = typeof FeatureTaskWorkspaceInput.Type;
export const FeatureTaskWorkspaceAttachInput = Schema.Struct({
  id: FeatureTaskId,
  worktreePath: TrimmedNonEmptyString,
});
export type FeatureTaskWorkspaceAttachInput = typeof FeatureTaskWorkspaceAttachInput.Type;
export const FeatureTaskWorkspaceResultSchema = FeatureTaskWorkspaceResult;
export const FeatureTaskDeliveryInput = Schema.Struct({ id: FeatureTaskId });
export type FeatureTaskDeliveryInput = typeof FeatureTaskDeliveryInput.Type;

export class FeatureTaskError extends Schema.TaggedError<FeatureTaskError>()("FeatureTaskError", {
  code: Schema.Literals(["not_found", "conflict", "invalid_link", "storage"]),
  message: Schema.String,
  taskId: Schema.optional(FeatureTaskId),
}) {}
