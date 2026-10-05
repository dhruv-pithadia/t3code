import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  FeatureTaskId,
  FeatureTaskError,
  DEFAULT_SERVER_SETTINGS,
  ThreadId,
  type OrchestrationV2ThreadLaunchResult,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type EnvironmentId,
  type FeatureTask,
  type FeatureTaskUpdateInput,
  type FeatureTaskStatus,
} from "@yantrix/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@yantrix/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import { StaticScreenProps, useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { SymbolView } from "../../components/AppSymbol";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import {
  useProjects,
  useEnvironmentServerConfig,
  useNavigationThreadShells,
} from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { orchestrationEnvironment } from "../../state/orchestration";
import { vcsEnvironment } from "../../state/vcs";
import { useEnvironmentQuery } from "../../state/query";
import { useFeatureTaskSnapshots } from "../../state/feature-tasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { useHomeThreadSelection } from "../home/home-thread-navigation";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";
import { buildModelOptions } from "../../lib/modelOptions";
import { resolveProjectSettings } from "@yantrix/shared/projectSettings";
import {
  linkFeatureTaskConversation,
  launchFeatureTaskConversation,
  type FeatureTaskLaunchInput,
} from "@yantrix/client-runtime/state/feature-tasks";
import {
  classifyLinkedThreadWorkspace,
  describeFeatureTaskError,
  FeatureTaskWorkspaceBlockedError,
  legacyFeatureTaskWorkspaceStrategy,
  launchBlockedByWorkspace,
  type FeatureTaskWorkspaceAction,
} from "@yantrix/client-runtime/state/feature-task-workspace";
import { SettingsSection } from "../settings/components/SettingsSection";
import { TaskDeliverySection, TaskWorkspaceSection } from "./TaskWorkspaceSections";

const STATUS_LABELS: Record<FeatureTaskStatus, string> = {
  requested: "Requested",
  planning: "Planning",
  building: "Building",
  verifying: "Verifying",
  ready_for_review: "Ready for review",
  paused: "Paused",
  blocked: "Blocked",
};

type FeatureTaskScopeParams = { readonly environmentId: string; readonly taskId: string };
type FeatureTaskEditorParams = { readonly environmentId?: string; readonly taskId?: string };

export function FeatureTasksRouteScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const projects = useProjects();
  const snapshots = useFeatureTaskSnapshots();
  const supportedProjects = projects.filter((project) =>
    snapshots.supportedEnvironmentIds.includes(project.environmentId),
  );
  const entries = [...snapshots.tasks].sort((left, right) =>
    right.task.updatedAt.localeCompare(left.task.updatedAt),
  );

  return (
    <>
      <NativeStackScreenOptions
        options={{
          title: "Feature tasks",
          unstable_headerRightItems: () => [
            {
              type: "button",
              icon: { name: "plus", type: "sfSymbol" },
              label: "New task",
              onPress: () => navigation.navigate("FeatureTaskEditor"),
            },
          ],
        }}
      />
      <ScreenScrollView
        className="flex-1 bg-screen"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 20 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        {entries.length === 0 ? (
          <EmptyState
            variant="plain"
            title={
              snapshots.supportedEnvironmentIds.length === 0
                ? "No task-enabled environment"
                : "Keep work moving"
            }
            detail={
              snapshots.supportedEnvironmentIds.length === 0
                ? "Feature tasks appear when a connected environment supports them."
                : snapshots.loadingEnvironmentIds.length > 0
                  ? "Loading your feature tasks..."
                  : "Save an objective, decisions, and the next action so work can continue in another conversation."
            }
            actionLabel={supportedProjects.length > 0 ? "Create feature task" : undefined}
            onAction={
              supportedProjects.length > 0
                ? () => navigation.navigate("FeatureTaskEditor")
                : undefined
            }
          />
        ) : (
          <View className="gap-3">
            {entries.map(({ environmentId, task }) => (
              <FeatureTaskCard
                key={`${environmentId}:${task.id}`}
                task={task}
                onPress={() =>
                  navigation.navigate("FeatureTaskDetail", {
                    environmentId: String(environmentId),
                    taskId: String(task.id),
                  })
                }
              />
            ))}
          </View>
        )}
        {snapshots.failedEnvironmentIds.length > 0 ? (
          <Text className="px-2 text-sm text-foreground-muted">
            Some environments could not load their task lists.
          </Text>
        ) : null}
      </ScreenScrollView>
    </>
  );
}

export function FeatureTaskDetailRouteScreen({ route }: StaticScreenProps<FeatureTaskScopeParams>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const environmentId = route.params.environmentId as EnvironmentId;
  const taskId = route.params.taskId as FeatureTaskId;
  const { tasks } = useFeatureTaskSnapshots();
  const task = tasks.find(
    (entry) => entry.environmentId === environmentId && entry.task.id === taskId,
  )?.task;
  const projects = useProjects();
  const threads = useNavigationThreadShells();
  const project = projects.find(
    (entry) => entry.environmentId === environmentId && entry.id === task?.projectId,
  );
  const configForTask = useEnvironmentServerConfig(environmentId);
  // Older hosts do not advertise task workspaces; every workspace call is skipped for them.
  const workspacesSupported =
    configForTask?.environment.capabilities.featureTaskWorkspaces === true;
  const refsQuery = useEnvironmentQuery(
    project && !workspacesSupported
      ? vcsEnvironment.listRefs({ environmentId, input: { cwd: project.workspaceRoot } })
      : null,
  );
  const workspaceQuery = useEnvironmentQuery(
    task && workspacesSupported
      ? serverEnvironment.inspectFeatureTaskWorkspace({ environmentId, input: { id: taskId } })
      : null,
  );
  const deliveryQuery = useEnvironmentQuery(
    task && workspacesSupported
      ? serverEnvironment.getFeatureTaskDelivery({ environmentId, input: { id: taskId } })
      : null,
  );
  const dependencyKey = (task?.dependencyIds ?? []).join("\n");
  const refreshDependencyWorkspace = workspaceQuery.refresh;
  const previousDependencyKey = useRef(dependencyKey);
  useEffect(() => {
    if (previousDependencyKey.current === dependencyKey) return;
    previousDependencyKey.current = dependencyKey;
    refreshDependencyWorkspace();
  }, [dependencyKey, refreshDependencyWorkspace, previousDependencyKey]);
  const binding = task?.workspace ?? workspaceQuery.data?.binding ?? null;
  // A task that owns a workspace cannot be worked on through a host that cannot verify it.
  const launchBlocked =
    ((task?.dependencyIds?.length ?? 0) > 0 &&
      configForTask?.environment.capabilities.featureTaskDependencies !== true) ||
    (workspacesSupported
      ? launchBlockedByWorkspace(
          workspaceQuery.data,
          workspaceQuery.error !== null,
          workspaceQuery.isPending,
        )
      : binding !== null);
  const linkedThreads =
    task?.threadIds.flatMap((threadId) => {
      const shell = threads.find(
        (entry) => entry.environmentId === environmentId && entry.id === threadId,
      );
      return shell ? [shell] : [];
    }) ?? [];
  const unlinkedThreads = threads.filter(
    (thread) =>
      thread.environmentId === environmentId &&
      thread.projectId === task?.projectId &&
      !task?.threadIds.includes(thread.id),
  );
  const updateTask = useAtomCommand(serverEnvironment.updateFeatureTask, { reportFailure: false });
  const getTask = useAtomCommand(serverEnvironment.readFeatureTask, { reportFailure: false });
  const launchThread = useAtomCommand(orchestrationEnvironment.v2.launchThread, {
    reportFailure: false,
  });
  const readWorkspace = useAtomCommand(serverEnvironment.readFeatureTaskWorkspace, {
    reportFailure: false,
  });
  const ensureWorkspace = useAtomCommand(serverEnvironment.ensureFeatureTaskWorkspace, {
    reportFailure: false,
  });
  const attachWorkspace = useAtomCommand(serverEnvironment.attachFeatureTaskWorkspace, {
    reportFailure: false,
  });
  const navigateToThread = useHomeThreadSelection();
  const [working, setWorking] = useState(false);
  const [linkRecovery, setLinkRecovery] = useState<{
    readonly threadId: ThreadId;
    readonly commandId: CommandId;
    readonly launchInput: FeatureTaskLaunchInput;
    readonly legacyWorkspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy;
    readonly launch: OrchestrationV2ThreadLaunchResult | null;
  } | null>(null);

  const getFreshTask = async () => {
    const result = await getTask({ environmentId, input: { id: taskId } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value.task;
  };
  const updateFreshTask = async (input: FeatureTaskUpdateInput) => {
    const result = await updateTask({ environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value.task;
  };
  const launchFreshThread = async (input: Parameters<typeof launchThread>[0]["input"]) => {
    const result = await launchThread({ environmentId, input });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return result.value;
  };
  const featureCommands = {
    ...(workspacesSupported
      ? {
          dependencyChecksSupported:
            configForTask?.environment.capabilities.featureTaskDependencies === true,
          workspace: {
            inspectWorkspace: async ({ id }: { id: FeatureTaskId }) => {
              const result = await readWorkspace({ environmentId, input: { id } });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
            ensureWorkspace: async ({ id }: { id: FeatureTaskId }) => {
              const result = await ensureWorkspace({ environmentId, input: { id } });
              if (result._tag === "Failure") throw squashAtomCommandFailure(result);
              return result.value;
            },
          },
        }
      : {}),
    getTask: getFreshTask,
    launchThread: launchFreshThread,
    updateTask: updateFreshTask,
  };

  const savePatch = async (
    patch:
      | FeatureTaskUpdateInput["patch"]
      | ((latest: FeatureTask) => FeatureTaskUpdateInput["patch"]),
  ) => {
    if (!task) return;
    setWorking(true);
    try {
      const latest = await getFreshTask();
      const result = await updateTask({
        environmentId,
        input: {
          id: latest.id,
          expectedVersion: latest.version,
          patch: typeof patch === "function" ? patch(latest) : patch,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (error) {
      Alert.alert("Could not update task", error instanceof Error ? error.message : "Try again.");
    } finally {
      setWorking(false);
    }
  };

  const linkThread = async (thread: EnvironmentThreadShell) => {
    setWorking(true);
    try {
      const result = await linkFeatureTaskConversation(featureCommands, taskId, thread.id);
      if (result.status === "linked") return;
      Alert.alert("Conversation not linked", errorMessage(result.error));
    } finally {
      setWorking(false);
    }
  };

  const continueThread = (thread: EnvironmentThreadShell) => {
    navigateToThread(thread);
  };

  const runWorkspaceAction = async (action: FeatureTaskWorkspaceAction, worktreePath?: string) => {
    if (action === "recheck") {
      workspaceQuery.refresh();
      return;
    }
    setWorking(true);
    try {
      const result =
        action === "attach" && worktreePath
          ? await attachWorkspace({ environmentId, input: { id: taskId, worktreePath } })
          : await ensureWorkspace({ environmentId, input: { id: taskId } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (error) {
      Alert.alert("Workspace not updated", errorMessage(error));
    } finally {
      workspaceQuery.refresh();
      setWorking(false);
    }
  };

  const finishLaunch = (
    attempt: NonNullable<typeof linkRecovery>,
    launched: Awaited<ReturnType<typeof launchFeatureTaskConversation>>,
  ) => {
    if (launched.status === "needs_link") {
      setLinkRecovery({ ...attempt, launch: launched.launch });
      Alert.alert(
        "Conversation created",
        `The empty conversation is ready, but Yantrix could not link it to this task. Retry linking before sending a message. ${errorMessage(launched.error)}`,
      );
      return;
    }
    setLinkRecovery(null);
    navigateToThread({ environmentId, id: launched.launch.threadId });
  };

  const startConversation = async () => {
    if (!task) return;

    if (linkRecovery) {
      setWorking(true);
      try {
        if (linkRecovery.launch === null) {
          // The previous request may have committed even if its response was
          // lost. Replay with the same ids; the workspace is re-resolved from
          // the task binding.
          finishLaunch(
            linkRecovery,
            await launchFeatureTaskConversation(featureCommands, {
              taskId: task.id,
              threadId: linkRecovery.threadId,
              commandId: linkRecovery.commandId,
              launchInput: linkRecovery.launchInput,
              legacyWorkspaceStrategy: linkRecovery.legacyWorkspaceStrategy,
            }),
          );
          return;
        }
        const linked = await linkFeatureTaskConversation(
          featureCommands,
          task.id,
          linkRecovery.launch.threadId,
        );
        if (linked.status === "needs_link") {
          Alert.alert("Conversation not linked", errorMessage(linked.error));
          return;
        }
        setLinkRecovery(null);
        navigateToThread({ environmentId, id: linkRecovery.threadId });
      } catch (error) {
        workspaceQuery.refresh();
        Alert.alert("Could not resume conversation", errorMessage(error));
      } finally {
        setWorking(false);
      }
      return;
    }

    if (!project) return;
    if (!workspacesSupported && task.threadIds.length > 0 && linkedThreads.length === 0) {
      Alert.alert(
        "Linked conversations unavailable",
        "Reconnect or refresh this environment, then open one of the task's linked conversations before starting another. Yantrix needs an available linked conversation to reuse its workspace safely.",
      );
      return;
    }
    const modelSelection = scheduledTaskDefaultModel(configForTask, project);
    const modelIsAvailable =
      modelSelection !== null &&
      buildModelOptions(configForTask, null).some(
        (option) =>
          option.selection.instanceId === modelSelection.instanceId &&
          option.selection.model === modelSelection.model,
      );
    if (!modelSelection || !modelIsAvailable) {
      Alert.alert("Choose a model", "Set up a provider and model for this environment first.");
      return;
    }
    const existing = [...linkedThreads].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0];
    const settings = resolveProjectSettings(
      configForTask?.settings ?? DEFAULT_SERVER_SETTINGS,
      project.id,
      project,
    ).settings;
    const launchInput = {
      projectId: task.projectId,
      title: task.title,
      modelSelection,
      runtimeMode: existing?.runtimeMode ?? settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
      interactionMode: existing?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
    } satisfies FeatureTaskLaunchInput;
    const defaultBranch = refsQuery.data?.refs.find((ref) => ref.isDefault)?.name;
    const legacyWorkspaceStrategy = legacyFeatureTaskWorkspaceStrategy(
      existing ?? null,
      settings.defaultThreadEnvMode === "worktree" && defaultBranch
        ? {
            type: "worktree",
            baseRef: defaultBranch,
            startFromOrigin: settings.newWorktreesStartFromOrigin,
          }
        : { type: "root" },
    );
    const attempt = {
      threadId: ThreadId.make(uuidv4()),
      commandId: CommandId.make(uuidv4()),
      launch: null,
      launchInput,
      legacyWorkspaceStrategy,
    };
    // Kept until the launch resolves so a lost response replays with the same ids.
    setLinkRecovery(attempt);
    setWorking(true);
    try {
      const launched = await launchFeatureTaskConversation(featureCommands, {
        taskId: task.id,
        threadId: attempt.threadId,
        commandId: attempt.commandId,
        launchInput,
        legacyWorkspaceStrategy,
      });
      finishLaunch(attempt, launched);
    } catch (error) {
      workspaceQuery.refresh();
      // A blocked workspace means nothing was created, so a fresh tap starts over.
      if (error instanceof FeatureTaskWorkspaceBlockedError) setLinkRecovery(null);
      Alert.alert(
        error instanceof FeatureTaskWorkspaceBlockedError
          ? "Task workspace needs attention"
          : "Could not start conversation",
        errorMessage(error),
      );
    } finally {
      setWorking(false);
    }
  };
  if (!task) {
    return (
      <>
        <NativeStackScreenOptions options={{ title: "Feature task" }} />
        <ScreenScrollView className="flex-1 bg-screen" contentContainerClassName="px-5 py-5">
          <EmptyState
            title="Task unavailable"
            detail="This task may have been removed or its environment is disconnected."
          />
        </ScreenScrollView>
      </>
    );
  }

  return (
    <>
      <NativeStackScreenOptions
        options={{
          title: "Task details",
          unstable_headerRightItems: () => [
            {
              type: "button",
              icon: { name: "pencil", type: "sfSymbol" },
              label: "Edit",
              onPress: () =>
                navigation.navigate("FeatureTaskEditor", {
                  environmentId: String(environmentId),
                  taskId: String(task.id),
                }),
            },
          ],
        }}
      />
      <ScreenScrollView
        className="flex-1 bg-screen"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 20 }}
      >
        <View className="gap-2 px-1">
          <Text className="text-2xl font-yantrix-bold text-foreground">{task.title}</Text>
          <Text className="text-sm text-foreground-muted">
            {project?.title ?? "Project unavailable"} · {STATUS_LABELS[task.status]}
          </Text>
        </View>
        <TaskTextSection title="Objective" value={task.objective || "No objective recorded yet."} />
        <TaskTextSection
          title="Acceptance criteria"
          value={
            task.acceptanceCriteria.length
              ? task.acceptanceCriteria.map((criterion) => `• ${criterion}`).join("\n")
              : "No acceptance criteria yet."
          }
        />
        <TaskTextSection
          title="Decisions"
          value={
            task.decisions.length
              ? task.decisions.map((decision) => `• ${decision}`).join("\n")
              : "No decisions recorded yet."
          }
        />
        <TaskTextSection title="Next action" value={task.nextAction || "Choose the next action."} />
        {task.handoff ? <TaskTextSection title="Handoff" value={task.handoff} /> : null}

        <SettingsSection title="Progress">
          <View className="flex-row flex-wrap gap-2 p-4">
            {(Object.keys(STATUS_LABELS) as FeatureTaskStatus[]).map((status) => (
              <Pressable
                key={status}
                accessibilityRole="button"
                accessibilityState={{ selected: task.status === status }}
                disabled={working || task.status === status}
                className={`rounded-full border px-3 py-2 ${task.status === status ? "border-primary bg-primary/10" : "border-border bg-card"}`}
                onPress={() => void savePatch({ status })}
              >
                <Text
                  className={`text-xs font-yantrix-medium ${task.status === status ? "text-primary" : "text-foreground-muted"}`}
                >
                  {STATUS_LABELS[status]}
                </Text>
              </Pressable>
            ))}
          </View>
        </SettingsSection>

        {workspacesSupported ? (
          <>
            <TaskWorkspaceSection
              workspace={workspaceQuery.data}
              error={workspaceQuery.error}
              isPending={workspaceQuery.isPending}
              archived={task.archivedAt !== null}
              working={working}
              onAction={(action, worktreePath) => void runWorkspaceAction(action, worktreePath)}
            />
            <TaskDeliverySection
              hasWorkspace={binding !== null}
              delivery={deliveryQuery.data}
              error={deliveryQuery.error}
              isPending={deliveryQuery.isPending}
              onRefresh={deliveryQuery.refresh}
            />
          </>
        ) : null}

        <SettingsSection title={`Conversations (${task.threadIds.length})`}>
          <View className="gap-2 p-4">
            {linkedThreads.map((thread) => (
              <View
                key={thread.id}
                className="flex-row items-center gap-2 rounded-xl border border-border-subtle px-3 py-2"
              >
                <Pressable
                  className="min-h-11 min-w-0 flex-1 justify-center"
                  accessibilityRole="button"
                  onPress={() => continueThread(thread)}
                >
                  <Text className="text-base font-yantrix-medium text-foreground" numberOfLines={1}>
                    {thread.title || "Untitled conversation"}
                  </Text>
                  <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                    {classifyLinkedThreadWorkspace(binding, thread) === "different"
                      ? "Different workspace, not moved"
                      : classifyLinkedThreadWorkspace(binding, thread) === "unverified"
                        ? "Branch unknown, not moved"
                        : (thread.branch ?? thread.worktreePath ?? "Project workspace")}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Unlink conversation"
                  disabled={working}
                  className="min-h-11 items-center justify-center px-2"
                  onPress={() =>
                    void savePatch((latest) => ({
                      threadIds: latest.threadIds.filter((id) => id !== thread.id),
                    }))
                  }
                >
                  <SymbolView name="pin.slash" size={17} />
                </Pressable>
              </View>
            ))}
            {task.threadIds.length > linkedThreads.length ? (
              <Text className="text-sm text-foreground-muted">
                Some linked conversations are not available in the current thread list.
              </Text>
            ) : null}
            {unlinkedThreads.length > 0 ? (
              <View className="gap-1 border-t border-border-subtle pt-3">
                <Text className="px-1 text-sm font-yantrix-medium text-foreground-muted">
                  Link an existing conversation
                </Text>
                {unlinkedThreads.slice(0, 8).map((thread) => (
                  <Pressable
                    key={thread.id}
                    accessibilityRole="button"
                    disabled={working}
                    className="min-h-11 flex-row items-center gap-2 rounded-xl px-2 active:bg-card"
                    onPress={() => void linkThread(thread)}
                  >
                    <Text className="min-w-0 flex-1 text-sm text-foreground" numberOfLines={1}>
                      {thread.title || "Untitled conversation"}
                    </Text>
                    <SymbolView name="link" size={16} />
                  </Pressable>
                ))}
              </View>
            ) : null}
            {launchBlocked ? (
              <Text className="text-sm leading-5 text-foreground-muted">
                Repair the task workspace above before starting a conversation.
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={working || launchBlocked}
              className={`mt-1 min-h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 active:opacity-75 ${launchBlocked ? "opacity-50" : ""}`}
              onPress={() => void startConversation()}
            >
              <SymbolView
                name={linkRecovery ? "arrow.clockwise" : "plus"}
                size={17}
                tintColor="white"
              />
              <Text className="font-yantrix-bold text-primary-foreground">
                {working
                  ? "Starting..."
                  : linkRecovery
                    ? "Retry linking conversation"
                    : "Start conversation"}
              </Text>
            </Pressable>
          </View>
        </SettingsSection>

        {!workspacesSupported && binding ? (
          <SettingsSection title="Workspace">
            <Text
              accessibilityRole="alert"
              className="p-4 text-sm leading-5 text-danger-foreground"
            >
              This task has its own workspace, but this server cannot verify it. Update the server
              to start work on it.
            </Text>
          </SettingsSection>
        ) : null}
        <Pressable
          accessibilityRole="button"
          disabled={working}
          className="min-h-12 items-center justify-center rounded-xl border border-border bg-card active:opacity-70"
          onPress={() => void savePatch({ archived: task.archivedAt === null })}
        >
          <Text className="font-yantrix-medium text-foreground">
            {task.archivedAt === null ? "Archive task" : "Unarchive task"}
          </Text>
        </Pressable>
      </ScreenScrollView>
    </>
  );
}

export function FeatureTaskEditorRouteScreen({
  route,
}: StaticScreenProps<FeatureTaskEditorParams | undefined>) {
  const projects = useProjects();
  const snapshots = useFeatureTaskSnapshots();
  const editing = route.params?.taskId
    ? snapshots.tasks.find(
        (entry) =>
          entry.environmentId === route.params?.environmentId &&
          entry.task.id === route.params.taskId,
      )
    : undefined;

  if (route.params?.taskId && !editing) {
    return (
      <>
        <NativeStackScreenOptions options={{ title: "Edit feature task" }} />
        <ScreenScrollView className="flex-1 bg-screen" contentContainerClassName="px-5 py-5">
          <EmptyState
            title="Loading feature task"
            detail="The task details are loading from this environment."
          />
        </ScreenScrollView>
      </>
    );
  }

  return (
    <FeatureTaskEditorForm
      task={editing?.task ?? null}
      editingEnvironmentId={editing?.environmentId}
      projects={projects}
      supportedEnvironmentIds={snapshots.supportedEnvironmentIds}
    />
  );
}

function FeatureTaskEditorForm(props: {
  readonly task: FeatureTask | null;
  readonly editingEnvironmentId?: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly supportedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}) {
  // Keep the revision opened by this form. The live task list can advance
  // while these inputs are being edited; saving against that newer revision
  // would silently overwrite concurrent changes.
  const [task] = useState(props.task);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [projectKey, setProjectKey] = useState(
    task && props.editingEnvironmentId ? `${props.editingEnvironmentId}:${task.projectId}` : "",
  );
  const availableProjects = props.projects.filter((project) =>
    props.supportedEnvironmentIds.includes(project.environmentId),
  );
  const effectiveProjectKey =
    projectKey ||
    (availableProjects[0]
      ? `${availableProjects[0].environmentId}:${availableProjects[0].id}`
      : "");
  const chosenProject = props.projects.find(
    (project) => `${project.environmentId}:${project.id}` === effectiveProjectKey,
  );
  const taskSnapshots = useFeatureTaskSnapshots();
  const chosenConfig = useEnvironmentServerConfig(
    chosenProject?.environmentId ?? props.editingEnvironmentId ?? null,
  );
  const dependenciesSupported =
    chosenConfig?.environment.capabilities.featureTaskDependencies === true;
  const [dependencyIds, setDependencyIds] = useState<ReadonlyArray<FeatureTaskId>>(
    task?.dependencyIds ?? [],
  );
  const candidates = taskSnapshots.tasks.filter(
    (entry) =>
      entry.environmentId === (chosenProject?.environmentId ?? props.editingEnvironmentId) &&
      entry.task.projectId === (task?.projectId ?? chosenProject?.id) &&
      entry.task.id !== task?.id,
  );
  const createTask = useAtomCommand(serverEnvironment.createFeatureTask, { reportFailure: false });
  const updateTask = useAtomCommand(serverEnvironment.updateFeatureTask, { reportFailure: false });
  const [title, setTitle] = useState(task?.title ?? "");
  const [objective, setObjective] = useState(task?.objective ?? "");
  const [criteria, setCriteria] = useState(task?.acceptanceCriteria.join("\n") ?? "");
  const [decisions, setDecisions] = useState(task?.decisions.join("\n") ?? "");
  const [nextAction, setNextAction] = useState(task?.nextAction ?? "");
  const [handoff, setHandoff] = useState(task?.handoff ?? "");
  const [saving, setSaving] = useState(false);
  const pendingCreateTaskId = useRef<FeatureTaskId | null>(null);
  const fields = [
    {
      label: "Title",
      value: title,
      change: setTitle,
      placeholder: "A short name",
      multiline: false,
    },
    {
      label: "Objective",
      value: objective,
      change: setObjective,
      placeholder: "What should be true when this is complete?",
      multiline: true,
    },
    {
      label: "Acceptance criteria",
      value: criteria,
      change: setCriteria,
      placeholder: "One criterion per line",
      multiline: true,
    },
    {
      label: "Decisions",
      value: decisions,
      change: setDecisions,
      placeholder: "One decision per line",
      multiline: true,
    },
    {
      label: "Next action",
      value: nextAction,
      change: setNextAction,
      placeholder: "The next concrete step",
      multiline: true,
    },
    {
      label: "Handoff",
      value: handoff,
      change: setHandoff,
      placeholder: "Context for the next conversation",
      multiline: true,
    },
  ] as const;

  const save = async () => {
    if (saving || title.trim().length === 0 || (!task && !chosenProject)) return;
    setSaving(true);
    const splitLines = (value: string) => [
      ...new Set(
        value
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ];
    try {
      if (task && props.editingEnvironmentId) {
        const result = await updateTask({
          environmentId: props.editingEnvironmentId,
          input: {
            id: task.id,
            expectedVersion: task.version,
            patch: {
              title: title.trim(),
              objective: objective.trim(),
              acceptanceCriteria: splitLines(criteria),
              decisions: splitLines(decisions),
              nextAction: nextAction.trim(),
              handoff: handoff.trim(),
              ...(dependenciesSupported ? { dependencyIds } : {}),
            },
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        navigation.goBack();
      } else if (chosenProject) {
        pendingCreateTaskId.current ??= FeatureTaskId.make(`feature-task:${uuidv4()}`);
        const taskId = pendingCreateTaskId.current;
        const result = await createTask({
          environmentId: chosenProject.environmentId,
          input: {
            id: taskId,
            projectId: chosenProject.id,
            title: title.trim(),
            objective: objective.trim(),
            acceptanceCriteria: splitLines(criteria),
            decisions: splitLines(decisions),
            nextAction: nextAction.trim(),
            handoff: handoff.trim(),
            threadIds: [],
            ...(dependenciesSupported ? { dependencyIds } : {}),
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        navigation.navigate("FeatureTaskDetail", {
          environmentId: String(chosenProject.environmentId),
          taskId: String(result.value.task.id),
        });
      }
    } catch (error) {
      if (isFeatureTaskConflict(error)) {
        Alert.alert(
          "Task changed",
          "Your edits are still here. This task changed after you opened it. Close this editor and reopen the task to load the latest version before saving.",
        );
      } else {
        Alert.alert("Could not save feature task", errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <NativeStackScreenOptions
        options={{ title: task ? "Edit feature task" : "New feature task" }}
      />
      <ScreenScrollView
        className="flex-1 bg-screen"
        contentContainerClassName="gap-5 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 22 }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        {!task ? (
          <SettingsSection title="Project">
            <View className="gap-1 p-3">
              {availableProjects.length === 0 ? (
                <Text className="p-2 text-sm text-foreground-muted">
                  No connected project supports feature tasks yet.
                </Text>
              ) : (
                availableProjects.map((project) => (
                  <ProjectChoice
                    key={`${project.environmentId}:${project.id}`}
                    project={project}
                    selected={effectiveProjectKey === `${project.environmentId}:${project.id}`}
                    onPress={() => {
                      setProjectKey(`${project.environmentId}:${project.id}`);
                      setDependencyIds([]);
                    }}
                  />
                ))
              )}
            </View>
          </SettingsSection>
        ) : null}
        {dependenciesSupported ? (
          <SettingsSection title="Prerequisites">
            <View className="gap-2 p-4">
              <Text className="text-sm text-foreground-muted">
                Wait for these tasks to merge before starting.
              </Text>
              {candidates.map(({ task: candidate }) => (
                <Pressable
                  key={candidate.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: dependencyIds.includes(candidate.id) }}
                  className="min-h-11 justify-center rounded-xl border border-border px-3"
                  onPress={() =>
                    setDependencyIds(
                      dependencyIds.includes(candidate.id)
                        ? dependencyIds.filter((id) => id !== candidate.id)
                        : [...dependencyIds, candidate.id],
                    )
                  }
                >
                  <Text>
                    {dependencyIds.includes(candidate.id) ? "Selected: " : ""}
                    {candidate.title}
                  </Text>
                </Pressable>
              ))}
            </View>
          </SettingsSection>
        ) : null}
        <SettingsSection title="Task record">
          <View className="divide-y divide-border-subtle">
            {fields.map((field, index) => (
              <View key={field.label} className="gap-2 px-4 py-3">
                <Text className="text-sm font-yantrix-medium text-foreground-muted">
                  {field.label}
                </Text>
                <AppTextInput
                  accessibilityLabel={field.label}
                  className={
                    field.multiline
                      ? "min-h-24 rounded-xl bg-screen px-3 py-2 text-base text-foreground"
                      : "min-h-11 rounded-xl bg-screen px-3 text-base text-foreground"
                  }
                  placeholder={field.placeholder}
                  placeholderTextColorClassName="accent-foreground-muted"
                  value={field.value}
                  onChangeText={field.change}
                  multiline={field.multiline}
                  textAlignVertical={field.multiline ? "top" : "center"}
                  returnKeyType={index === fields.length - 1 ? "done" : "next"}
                />
              </View>
            ))}
          </View>
        </SettingsSection>
        <Pressable
          accessibilityRole="button"
          disabled={saving || title.trim().length === 0 || (!task && chosenProject === undefined)}
          className="min-h-12 items-center justify-center rounded-xl bg-primary px-4 disabled:opacity-50"
          onPress={() => void save()}
        >
          <Text className="font-yantrix-bold text-primary-foreground">
            {saving ? "Saving..." : task ? "Save changes" : "Create feature task"}
          </Text>
        </Pressable>
      </ScreenScrollView>
    </>
  );
}

function FeatureTaskCard(props: { readonly task: FeatureTask; readonly onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="gap-2 rounded-2xl border border-border bg-card px-4 py-4 active:opacity-75"
    >
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-yantrix-bold text-foreground" numberOfLines={2}>
            {props.task.title}
          </Text>
          <Text className="text-xs font-yantrix-medium text-foreground-muted">
            {STATUS_LABELS[props.task.status]} · {props.task.threadIds.length}{" "}
            {props.task.threadIds.length === 1 ? "conversation" : "conversations"}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={15} />
      </View>
      {props.task.objective ? (
        <Text className="text-sm leading-5 text-foreground-muted" numberOfLines={3}>
          {props.task.objective}
        </Text>
      ) : null}
      {props.task.nextAction ? (
        <Text className="text-sm text-foreground">
          <Text className="font-yantrix-semibold">Next: </Text>
          {props.task.nextAction}
        </Text>
      ) : null}
    </Pressable>
  );
}

function TaskTextSection(props: { readonly title: string; readonly value: string }) {
  return (
    <SettingsSection title={props.title}>
      <Text className="px-4 py-3 text-sm leading-5 text-foreground">{props.value}</Text>
    </SettingsSection>
  );
}

function ProjectChoice(props: {
  readonly project: EnvironmentProject;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      className={`min-h-12 flex-row items-center gap-3 rounded-xl px-3 ${props.selected ? "bg-primary/10" : "active:bg-screen"}`}
      onPress={props.onPress}
    >
      <View
        className={`h-4 w-4 items-center justify-center rounded-full border ${props.selected ? "border-primary bg-primary" : "border-border"}`}
      >
        {props.selected ? (
          <View className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
        ) : null}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-yantrix-medium text-foreground" numberOfLines={1}>
          {props.project.title}
        </Text>
        <Text className="text-xs text-foreground-muted" numberOfLines={1}>
          {props.project.workspaceRoot}
        </Text>
      </View>
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  return describeFeatureTaskError(error);
}

function isFeatureTaskConflict(error: unknown): boolean {
  return error instanceof FeatureTaskError && error.code === "conflict";
}
