import {
  CommandId,
  FeatureTaskId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type FeatureTask,
  type FeatureTaskWorkspaceBinding,
  type FeatureTaskWorkspaceResult,
  type OrchestrationV2ThreadLaunchResult,
} from "@yantrix/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  FeatureTaskConversationError,
  launchFeatureTaskConversation,
  linkFeatureTaskConversation,
  type FeatureTaskConversationCommands,
} from "./featureTasks.ts";
import {
  FeatureTaskWorkspaceBlockedError,
  FeatureTaskWorkspaceUnsupportedError,
} from "./featureTaskWorkspace.ts";

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
} satisfies Omit<
  Parameters<FeatureTaskConversationCommands["launchThread"]>[0],
  "commandId" | "threadId" | "initialMessage" | "workspaceStrategy"
>;

const binding: FeatureTaskWorkspaceBinding = {
  repoPath: "/repo",
  worktreePath: "/repo-worktrees/task-one",
  branch: "task/one",
  createdAt: "2026-10-05T00:00:00.000Z",
};
const readyWorkspace: FeatureTaskWorkspaceResult = {
  state: "ready",
  binding,
  recoveryAvailable: false,
};

const launchResult: OrchestrationV2ThreadLaunchResult = {
  threadId,
  projection: {} as OrchestrationV2ThreadLaunchResult["projection"],
  resumed: false,
};

describe("feature task conversation linking", () => {
  it("launches inside the task binding and ignores sibling conversation workspaces", async () => {
    const commands = makeCommands(makeTask());
    const launchedWith: unknown[] = [];
    commands.launchThreadImpl = async (input) => {
      launchedWith.push(input.workspaceStrategy);
      return launchResult;
    };
    const result = await launchFeatureTaskConversation(commands, createInput());
    expect(result.status).toBe("linked");
    expect(result.workspace).toEqual(binding);
    expect(launchedWith).toEqual([
      { type: "existing_worktree", worktreePath: binding.worktreePath, branch: binding.branch },
    ]);
    expect(commands.ensureCalls).toBe(0);
  });

  it("keeps the legacy strategy for an unbound task on a host without task workspaces", async () => {
    const commands = makeCommands(makeTask(), { withWorkspace: false });
    const launchedWith: unknown[] = [];
    commands.launchThreadImpl = async (input) => {
      launchedWith.push(input.workspaceStrategy);
      return launchResult;
    };
    const legacyWorkspaceStrategy = { type: "root", branch: "feature/legacy" } as const;
    const result = await launchFeatureTaskConversation(
      commands,
      createInput({ legacyWorkspaceStrategy }),
    );
    expect(result.status).toBe("linked");
    expect(result.workspace).toBeNull();
    expect(launchedWith).toEqual([legacyWorkspaceStrategy]);
  });

  it("never launches a bound task through a host that cannot verify its workspace", async () => {
    const commands = makeCommands(makeTask({ workspace: binding }), { withWorkspace: false });
    await expect(
      launchFeatureTaskConversation(
        commands,
        createInput({ legacyWorkspaceStrategy: { type: "root" } }),
      ),
    ).rejects.toBeInstanceOf(FeatureTaskWorkspaceUnsupportedError);
    expect(commands.launchCalls).toBe(0);
  });

  it("refuses a host without task workspaces when no legacy strategy was given", async () => {
    const commands = makeCommands(makeTask(), { withWorkspace: false });
    await expect(launchFeatureTaskConversation(commands, createInput())).rejects.toBeInstanceOf(
      FeatureTaskWorkspaceUnsupportedError,
    );
    expect(commands.launchCalls).toBe(0);
  });

  it("ignores a legacy strategy when the host supports task workspaces", async () => {
    const commands = makeCommands(makeTask());
    const launchedWith: unknown[] = [];
    commands.launchThreadImpl = async (input) => {
      launchedWith.push(input.workspaceStrategy);
      return launchResult;
    };
    await launchFeatureTaskConversation(
      commands,
      createInput({ legacyWorkspaceStrategy: { type: "root" } }),
    );
    expect(launchedWith).toEqual([
      { type: "existing_worktree", worktreePath: binding.worktreePath, branch: binding.branch },
    ]);
  });

  it("provisions an unbound task before creating the conversation", async () => {
    const commands = makeCommands(makeTask());
    const order: string[] = [];
    commands.inspectImpl = async () => ({
      state: "unbound",
      binding: null,
      recoveryAvailable: false,
    });
    commands.ensureImpl = async () => {
      order.push("ensure");
      return readyWorkspace;
    };
    commands.launchThreadImpl = async () => {
      order.push("launch");
      return launchResult;
    };
    await launchFeatureTaskConversation(commands, createInput());
    expect(order).toEqual(["ensure", "launch"]);
  });

  it("never launches or provisions when the workspace needs manual repair", async () => {
    for (const state of ["branch_mismatch", "conflict"] as const) {
      const commands = makeCommands(makeTask());
      commands.inspectImpl = async () => ({ state, binding, recoveryAvailable: true });
      await expect(launchFeatureTaskConversation(commands, createInput())).rejects.toBeInstanceOf(
        FeatureTaskWorkspaceBlockedError,
      );
      expect(commands.ensureCalls).toBe(0);
      expect(commands.launchCalls).toBe(0);
    }
  });

  it("restores a missing worktree only when the server says recovery is available", async () => {
    const recoverable = makeCommands(makeTask());
    recoverable.inspectImpl = async () => ({ state: "missing", binding, recoveryAvailable: true });
    await launchFeatureTaskConversation(recoverable, createInput());
    expect(recoverable.ensureCalls).toBe(1);
    expect(recoverable.launchCalls).toBe(1);

    const stuck = makeCommands(makeTask());
    stuck.inspectImpl = async () => ({ state: "missing", binding, recoveryAvailable: false });
    await expect(launchFeatureTaskConversation(stuck, createInput())).rejects.toMatchObject({
      state: "missing",
    });
    expect(stuck.ensureCalls).toBe(0);
    expect(stuck.launchCalls).toBe(0);
  });

  it("does not launch when provisioning does not end ready", async () => {
    const commands = makeCommands(makeTask());
    commands.inspectImpl = async () => ({
      state: "unbound",
      binding: null,
      recoveryAvailable: false,
    });
    commands.ensureImpl = async () => ({ state: "conflict", binding, recoveryAvailable: false });
    await expect(launchFeatureTaskConversation(commands, createInput())).rejects.toMatchObject({
      state: "conflict",
    });
    expect(commands.launchCalls).toBe(0);
  });

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

/**
 * Counting stubs around the real command surface. Behavior is swapped through
 * the `*Impl` fields; `withWorkspace: false` models a host that does not
 * advertise task workspaces, where the optional workspace commands are absent.
 */
function makeCommands(
  initialTask: FeatureTask,
  options: { readonly withWorkspace?: boolean } = {},
) {
  const stubs = {
    launchCalls: 0,
    updateCalls: 0,
    ensureCalls: 0,
    inspectImpl: async (): Promise<FeatureTaskWorkspaceResult> => readyWorkspace,
    ensureImpl: async (): Promise<FeatureTaskWorkspaceResult> => readyWorkspace,
    getTaskImpl: async (): Promise<FeatureTask> => initialTask,
    launchThreadImpl: async (
      _input: Parameters<FeatureTaskConversationCommands["launchThread"]>[0],
    ): Promise<OrchestrationV2ThreadLaunchResult> => launchResult,
    updateTaskImpl: async (
      _input: Parameters<FeatureTaskConversationCommands["updateTask"]>[0],
    ): Promise<FeatureTask> => initialTask,
  };
  const commands: FeatureTaskConversationCommands & typeof stubs = {
    ...stubs,
    ...(options.withWorkspace === false
      ? {}
      : {
          workspace: {
            inspectWorkspace: () => commands.inspectImpl(),
            ensureWorkspace: () => {
              commands.ensureCalls += 1;
              return commands.ensureImpl();
            },
          },
        }),
    getTask: () => commands.getTaskImpl(),
    launchThread: (input) => {
      commands.launchCalls += 1;
      return commands.launchThreadImpl(input);
    },
    updateTask: (input) => {
      commands.updateCalls += 1;
      return commands.updateTaskImpl(input);
    },
  };
  return commands;
}
