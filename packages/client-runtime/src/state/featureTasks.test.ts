import {
  CommandId,
  FeatureTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type FeatureTask,
  type OrchestrationV2ThreadLaunchResult,
} from "@yantrix/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FeatureTaskConversationError,
  launchFeatureTaskConversation,
  linkFeatureTaskConversation,
  type FeatureTaskConversationCommands,
} from "./featureTasks.ts";

const taskId = FeatureTaskId.make("feature-task:one");
const projectId = ProjectId.make("project:one");
const threadId = ThreadId.make("thread:one");
const existingThreadId = ThreadId.make("thread:existing");

function makeTask(overrides: Partial<FeatureTask> = {}): FeatureTask {
  return {
    id: taskId,
    projectId,
    title: "Build the mobile task view",
    objective: "Keep the task across conversations.",
    acceptanceCriteria: ["Tasks survive restart"],
    decisions: [],
    nextAction: "Build the screen",
    handoff: "",
    status: "requested",
    threadIds: [],
    archivedAt: null,
    version: 1,
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

const launchInput = {
  projectId,
  title: "Build the mobile task view",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
} satisfies Omit<
  Parameters<FeatureTaskConversationCommands["launchThread"]>[0],
  "commandId" | "threadId" | "initialMessage"
>;

const launchResult: OrchestrationV2ThreadLaunchResult = {
  threadId,
  projection: {} as OrchestrationV2ThreadLaunchResult["projection"],
  resumed: false,
};

describe("feature task conversation linking", () => {
  it("checks that the task is active and belongs to the selected project before launching", async () => {
    const archivedCommands = makeCommands(makeTask({ archivedAt: "2026-10-05T00:00:00.000Z" }));
    await expect(
      launchFeatureTaskConversation(archivedCommands, createInput()),
    ).rejects.toMatchObject<Partial<FeatureTaskConversationError>>({ reason: "archived" });
    expect(archivedCommands.launchCalls).toBe(0);

    const mismatchedCommands = makeCommands(makeTask());
    await expect(
      launchFeatureTaskConversation(
        mismatchedCommands,
        createInput({
          launchInput: { ...launchInput, projectId: ProjectId.make("project:other") },
        }),
      ),
    ).rejects.toMatchObject<Partial<FeatureTaskConversationError>>({ reason: "project_mismatch" });
    expect(mismatchedCommands.launchCalls).toBe(0);
  });

  it("keeps the created conversation recoverable after a version conflict", async () => {
    const commands = makeCommands(makeTask());
    let changedAfterLaunch = false;
    commands.getTaskImpl = async () => {
      if (changedAfterLaunch) {
        return makeTask({
          version: 2,
          decisions: ["A concurrent edit must remain"],
        });
      }
      return makeTask();
    };
    commands.launchThreadImpl = async () => {
      changedAfterLaunch = true;
      return launchResult;
    };
    commands.updateTaskImpl = async () => {
      throw new Error("version conflict");
    };

    const result = await launchFeatureTaskConversation(commands, createInput());
    expect(result.status).toBe("needs_link");
    if (result.status !== "needs_link") throw new Error("Expected a recoverable link failure.");
    expect(result.launch.threadId).toBe(threadId);
    expect(result.task?.decisions).toEqual(["A concurrent edit must remain"]);
    expect(result.error).toEqual(new Error("version conflict"));
    expect(commands.launchCalls).toBe(1);
  });

  it("refreshes and unions current thread links, then retries association without launching again", async () => {
    let current = makeTask({ threadIds: [existingThreadId], version: 3 });
    const commands = makeCommands(current);
    commands.getTaskImpl = async () => current;
    commands.updateTaskImpl = async (input) => {
      expect(input.expectedVersion).toBe(3);
      expect(input.patch.threadIds).toEqual([existingThreadId, threadId]);
      current = makeTask({
        ...current,
        threadIds: input.patch.threadIds ?? current.threadIds,
        version: 4,
      });
      return current;
    };

    const linked = await linkFeatureTaskConversation(commands, taskId, threadId);
    expect(linked).toEqual({ status: "linked", task: current });
    expect(commands.launchCalls).toBe(0);

    const alreadyLinked = await linkFeatureTaskConversation(commands, taskId, threadId);
    expect(alreadyLinked).toEqual({ status: "linked", task: current });
    expect(commands.updateCalls).toBe(1);
  });
});

function createInput(
  overrides: Partial<Parameters<typeof launchFeatureTaskConversation>[1]> = {},
): Parameters<typeof launchFeatureTaskConversation>[1] {
  return {
    taskId,
    threadId,
    commandId: CommandId.make("command:one"),
    launchInput,
    ...overrides,
  };
}

function makeCommands(initialTask: FeatureTask) {
  const commands: FeatureTaskConversationCommands & {
    launchCalls: number;
    updateCalls: number;
    getTaskImpl: () => Promise<FeatureTask>;
    launchThreadImpl: () => Promise<OrchestrationV2ThreadLaunchResult>;
    updateTaskImpl: (
      input: Parameters<FeatureTaskConversationCommands["updateTask"]>[0],
    ) => Promise<FeatureTask>;
  } = {
    launchCalls: 0,
    updateCalls: 0,
    getTaskImpl: async () => initialTask,
    launchThreadImpl: async () => launchResult,
    updateTaskImpl: async () => initialTask,
    getTask: () => commands.getTaskImpl(),
    launchThread: () => {
      commands.launchCalls += 1;
      return commands.launchThreadImpl();
    },
    updateTask: (input) => {
      commands.updateCalls += 1;
      return commands.updateTaskImpl(input);
    },
  };
  return commands;
}
