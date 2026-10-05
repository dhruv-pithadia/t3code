import {
  FeatureTask,
  FeatureTaskCreateInput,
  FeatureTaskGetInput,
  NonNegativeInt,
  FeatureTaskUpdateInput,
  OrchestratorMcpFailure,
  FeatureTaskWorkspaceInput,
  FeatureTaskWorkspaceAttachInput,
  FeatureTaskWorkspaceResult,
  FeatureTaskDeliveryInput,
  FeatureTaskDelivery,
} from "@yantrix/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as FeatureTasks from "../../../featureTasks/FeatureTaskService.ts";
import * as FeatureTaskWorkspaces from "../../../featureTasks/FeatureTaskWorkspaceService.ts";
import * as FeatureTaskDeliveryModule from "../../../featureTasks/FeatureTaskDeliveryService.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
    FeatureTasks.FeatureTaskService,
    FeatureTaskWorkspaces.FeatureTaskWorkspaceService,
    FeatureTaskDeliveryModule.FeatureTaskDeliveryService,
  ],
};

const List = Tool.make("yantrix_feature_task_list", {
  ...shared,
  description:
    "List persistent feature tasks in the calling conversation's project, including archived tasks. These tasks retain intent across conversations and restarts; they are separate from scheduled or delegated agent tasks.",
  parameters: Schema.Struct({
    cursor: Schema.optional(NonNegativeInt),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
  }),
  success: Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({
        id: FeatureTask.fields.id,
        title: FeatureTask.fields.title,
        status: FeatureTask.fields.status,
        version: FeatureTask.fields.version,
        archivedAt: FeatureTask.fields.archivedAt,
        threadIds: FeatureTask.fields.threadIds,
      }),
    ),
    nextCursor: Schema.NullOr(NonNegativeInt),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const Read = Tool.make("yantrix_feature_task_read", {
  ...shared,
  description:
    "Read a persistent feature task in the calling project. Omit id to read the task linked to this conversation. Read before updating to obtain the current version. Status is user-maintained intent, not proof of validation or merging.",
  parameters: Schema.Struct({ id: Schema.optional(FeatureTaskGetInput.fields.id) }),
  success: FeatureTask,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const { projectId: _projectId, ...createFields } = FeatureTaskCreateInput.fields;
const Create = Tool.make("yantrix_feature_task_create", {
  ...shared,
  description:
    "Create a persistent feature task in the calling project. Supply a stable unique id and reuse the same input when retrying. Set threadIds to link existing conversations in this project, or [] for an unlinked task. This saves intent without starting agent work or merging code.",
  parameters: Schema.Struct(createFields),
  success: FeatureTask,
}).annotate(Tool.Destructive, true);

const Update = Tool.make("yantrix_feature_task_update", {
  ...shared,
  description:
    "Update a persistent task's objective, acceptance criteria, decisions, next action, handoff, status, conversation links, or archive state in the calling project. Supply the latest expectedVersion; stale edits are rejected. Array fields replace the entire array. Archive is reversible. Record verified evidence in the handoff, and retain human merge approval.",
  parameters: FeatureTaskUpdateInput,
  success: FeatureTask,
}).annotate(Tool.Destructive, true);

const WorkspaceInspect = Tool.make("yantrix_feature_task_workspace_inspect", {
  ...shared,
  description:
    "Inspect the saved task checkout and branch identity. Reports missing, mismatched, or conflicting workspaces without changing them.",
  parameters: FeatureTaskWorkspaceInput,
  success: FeatureTaskWorkspaceResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const WorkspaceEnsure = Tool.make("yantrix_feature_task_workspace_ensure", {
  ...shared,
  description:
    "Create the task's own stable Git worktree, or restore its saved branch at the recorded path. It refuses work if linked conversations use a different checkout or the path/branch is ambiguous.",
  parameters: FeatureTaskWorkspaceInput,
  success: FeatureTaskWorkspaceResult,
}).annotate(Tool.Destructive, true);

const WorkspaceAttach = Tool.make("yantrix_feature_task_workspace_attach", {
  ...shared,
  description:
    "Explicitly bind a task to an existing registered worktree after repository and branch identity checks. Linked conversations must already use that exact checkout.",
  parameters: FeatureTaskWorkspaceAttachInput,
  success: FeatureTaskWorkspaceResult,
}).annotate(Tool.Destructive, true);

const Delivery = Tool.make("yantrix_feature_task_delivery", {
  ...shared,
  description:
    "Refresh the task's actual pull request, CI checks, and merge state. This is live delivery evidence and is independent from the task's progress status.",
  parameters: FeatureTaskDeliveryInput,
  success: FeatureTaskDelivery,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const FeatureTasksToolkit = Toolkit.make(
  List,
  Read,
  Create,
  Update,
  WorkspaceInspect,
  WorkspaceEnsure,
  WorkspaceAttach,
  Delivery,
);
