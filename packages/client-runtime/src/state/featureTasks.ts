import type {
  FeatureTask,
  FeatureTaskGetInput,
  FeatureTaskId,
  FeatureTaskUpdateInput,
  OrchestrationV2ThreadLaunchInput,
  OrchestrationV2ThreadLaunchResult,
  ThreadId,
} from "@yantrix/contracts";

export interface FeatureTaskConversationCommands {
  readonly getTask: (input: FeatureTaskGetInput) => Promise<FeatureTask>;
  readonly launchThread: (
    input: OrchestrationV2ThreadLaunchInput,
  ) => Promise<OrchestrationV2ThreadLaunchResult>;
  readonly updateTask: (input: FeatureTaskUpdateInput) => Promise<FeatureTask>;
}

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
    }
  | {
      readonly status: "needs_link";
      readonly task: FeatureTask | null;
      readonly launch: OrchestrationV2ThreadLaunchResult;
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
 * Creates an empty conversation, then links it before returning it for
 * navigation. Callers supply stable ids so a retried launch replays the same
 * command instead of creating a second conversation.
 */
export async function launchFeatureTaskConversation(
  commands: FeatureTaskConversationCommands,
  input: {
    readonly taskId: FeatureTaskId;
    readonly threadId: ThreadId;
    readonly launchInput: Omit<
      OrchestrationV2ThreadLaunchInput,
      "commandId" | "threadId" | "initialMessage"
    >;
    readonly commandId: OrchestrationV2ThreadLaunchInput["commandId"];
  },
): Promise<FeatureTaskConversationLaunchResult> {
  const task = await commands.getTask({ id: input.taskId });
  if (task.archivedAt !== null) throw new FeatureTaskConversationError("archived");
  if (task.projectId !== input.launchInput.projectId) {
    throw new FeatureTaskConversationError("project_mismatch");
  }

  const launch = await commands.launchThread({
    ...input.launchInput,
    commandId: input.commandId,
    threadId: input.threadId,
  });
  const linked = await linkFeatureTaskConversation(commands, input.taskId, launch.threadId);
  return linked.status === "linked"
    ? { status: "linked", task: linked.task, launch }
    : { status: "needs_link", task: linked.task, launch, error: linked.error };
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
