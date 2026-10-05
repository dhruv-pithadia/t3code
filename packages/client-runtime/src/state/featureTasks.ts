import type {
  FeatureTask,
  FeatureTaskGetInput,
  FeatureTaskId,
  FeatureTaskUpdateInput,
  FeatureTaskWorkspaceBinding,
  OrchestrationV2ThreadLaunchInput,
  OrchestrationV2ThreadLaunchResult,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ThreadId,
} from "@yantrix/contracts";

import {
  FeatureTaskWorkspaceUnsupportedError,
  resolveFeatureTaskWorkspace,
  workspaceStrategyForBinding,
  type FeatureTaskWorkspaceCommands,
} from "./featureTaskWorkspace.ts";

export interface FeatureTaskConversationCommands {
  /**
   * Present only when the server advertises `featureTaskWorkspaces`. Absent
   * means the host cannot provision or verify task workspaces at all.
   */
  readonly workspace?: FeatureTaskWorkspaceCommands;
  readonly getTask: (input: FeatureTaskGetInput) => Promise<FeatureTask>;
  readonly launchThread: (
    input: OrchestrationV2ThreadLaunchInput,
  ) => Promise<OrchestrationV2ThreadLaunchResult>;
  readonly updateTask: (input: FeatureTaskUpdateInput) => Promise<FeatureTask>;
}

/** Everything a task launch needs from the caller. The workspace comes from the task binding. */
export type FeatureTaskLaunchInput = Omit<
  OrchestrationV2ThreadLaunchInput,
  "commandId" | "threadId" | "initialMessage" | "workspaceStrategy"
>;

export type FeatureTaskConversationLinkResult =
  | {
      readonly status: "linked";
      readonly task: FeatureTask;
    }
  | {
      readonly status: "needs_link";
      readonly task: FeatureTask | null;
      readonly threadId: ThreadId;
      readonly error: unknown;
    };

export type FeatureTaskConversationLaunchResult =
  | {
      readonly status: "linked";
      readonly task: FeatureTask;
      readonly launch: OrchestrationV2ThreadLaunchResult;
      /** The task's own checkout, or null when a host without task workspaces used the legacy strategy. */
      readonly workspace: FeatureTaskWorkspaceBinding | null;
    }
  | {
      readonly status: "needs_link";
      readonly task: FeatureTask | null;
      readonly launch: OrchestrationV2ThreadLaunchResult;
      /** The task's own checkout, or null when a host without task workspaces used the legacy strategy. */
      readonly workspace: FeatureTaskWorkspaceBinding | null;
      readonly error: unknown;
    };

export class FeatureTaskConversationError extends Error {
  readonly reason: "not_found" | "archived" | "project_mismatch";

  constructor(reason: "not_found" | "archived" | "project_mismatch") {
    super(
      reason === "not_found"
        ? "This feature task is no longer available."
        : reason === "archived"
          ? "Unarchive this feature task before starting a conversation."
          : "The conversation must use the feature task's project.",
    );
    this.name = "FeatureTaskConversationError";
    this.reason = reason;
  }
}

/**
 * Resolves the workspace, creates an empty conversation inside it, then links
 * it before returning it for navigation. On a host with task workspaces the
 * workspace always comes from the task's binding, never from a sibling
 * conversation. A host without them keeps the caller's legacy strategy, but
 * only for a task that has no binding: a bound task is never started in a
 * checkout the host cannot verify. Callers supply stable ids so a retried
 * launch replays the same command instead of creating a second conversation.
 */
export async function launchFeatureTaskConversation(
  commands: FeatureTaskConversationCommands,
  input: {
    readonly taskId: FeatureTaskId;
    readonly threadId: ThreadId;
    readonly launchInput: FeatureTaskLaunchInput;
    /** Used only when `commands.workspace` is absent. */
    readonly legacyWorkspaceStrategy?: OrchestrationV2ThreadLaunchWorkspaceStrategy;
    readonly commandId: OrchestrationV2ThreadLaunchInput["commandId"];
  },
): Promise<FeatureTaskConversationLaunchResult> {
  const task = await commands.getTask({ id: input.taskId });
  if (task.archivedAt !== null) throw new FeatureTaskConversationError("archived");
  if (task.projectId !== input.launchInput.projectId) {
    throw new FeatureTaskConversationError("project_mismatch");
  }

  let workspace: FeatureTaskWorkspaceBinding | null = null;
  let workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy;
  if (commands.workspace) {
    workspace = await resolveFeatureTaskWorkspace(commands.workspace, input.taskId);
    workspaceStrategy = workspaceStrategyForBinding(workspace);
  } else {
    if (task.workspace) throw new FeatureTaskWorkspaceUnsupportedError();
    if (!input.legacyWorkspaceStrategy) {
      throw new FeatureTaskWorkspaceUnsupportedError(
        "A workspace strategy is required for this server.",
      );
    }
    workspaceStrategy = input.legacyWorkspaceStrategy;
  }
  const launch = await commands.launchThread({
    ...input.launchInput,
    workspaceStrategy,
    commandId: input.commandId,
    threadId: input.threadId,
  });
  const linked = await linkFeatureTaskConversation(commands, input.taskId, launch.threadId);
  return linked.status === "linked"
    ? { status: "linked", task: linked.task, launch, workspace }
    : { status: "needs_link", task: linked.task, launch, workspace, error: linked.error };
}

/** Retries only the association after an empty thread was already created. */
export async function linkFeatureTaskConversation(
  commands: Pick<FeatureTaskConversationCommands, "getTask" | "updateTask">,
  taskId: FeatureTaskId,
  threadId: ThreadId,
): Promise<FeatureTaskConversationLinkResult> {
  let current: FeatureTask | null = null;
  try {
    current = await commands.getTask({ id: taskId });
    if (current.archivedAt !== null) throw new FeatureTaskConversationError("archived");
    if (current.threadIds.includes(threadId)) return { status: "linked", task: current };

    const task = await commands.updateTask({
      id: taskId,
      expectedVersion: current.version,
      patch: { threadIds: [...current.threadIds, threadId] },
    });
    return { status: "linked", task };
  } catch (error) {
    try {
      current = await commands.getTask({ id: taskId });
    } catch {
      // Keep the original failure and thread id. A later explicit retry fetches
      // the authoritative version before attempting to link again.
    }
    return { status: "needs_link", task: current, threadId, error };
  }
}
