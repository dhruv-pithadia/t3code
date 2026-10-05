import { useCallback, useMemo, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CircleDashedIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  PlusIcon,
  RotateCcwIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  CommandId,
  type EnvironmentId,
  type FeatureTask,
  type FeatureTaskId,
  type FeatureTaskStatus,
  type OrchestrationV2ThreadLaunchInput,
  type ThreadId,
} from "@yantrix/contracts";
import { scopeThreadRef } from "@yantrix/client-runtime/environment";
import { resolveThreadCurrentPullRequestLink } from "@yantrix/shared/threadPullRequests";
import {
  launchFeatureTaskConversation,
  linkFeatureTaskConversation,
} from "@yantrix/client-runtime/state/feature-tasks";

import { useProjects, useThreadShells } from "../../state/entities";
import {
  useFeatureTask,
  useFeatureTasks,
  useFeatureTaskEnvironments,
  useReadFeatureTask,
  useUpdateFeatureTask,
} from "../../state/featureTasks";
import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { resolveProjectSettings } from "@yantrix/shared/projectSettings";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { scheduledTaskDefaultModel } from "../settings/scheduledTasksSettings.logic";
import { buildThreadRouteParams } from "../../threadRoutes";
import { newThreadId, randomUUID } from "../../lib/utils";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@yantrix/client-runtime/state/runtime";
import { Button } from "../ui/button";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SidebarInset } from "../ui/sidebar";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { latestAvailableTaskThread, selectFeatureTaskConversationModel } from "./TaskPage.logic";

const STATUS_META: Record<FeatureTaskStatus, { label: string; className: string }> = {
  requested: { label: "Requested", className: "border-border text-muted-foreground" },
  planning: {
    label: "Planning",
    className: "border-blue-500/25 bg-blue-500/8 text-blue-700 dark:text-blue-300",
  },
  building: {
    label: "Building",
    className: "border-violet-500/25 bg-violet-500/8 text-violet-700 dark:text-violet-300",
  },
  verifying: {
    label: "Verifying",
    className: "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  },
  ready_for_review: {
    label: "Ready for review",
    className: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  },
  paused: { label: "Paused", className: "border-border text-muted-foreground" },
  blocked: {
    label: "Blocked",
    className: "border-destructive/25 bg-destructive/8 text-destructive",
  },
};

function formatUpdatedAt(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

function projectName(
  projects: ReturnType<typeof useProjects>,
  environmentId: EnvironmentId,
  projectId: FeatureTask["projectId"],
) {
  return (
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.title ?? "Workspace unavailable"
  );
}

export function TasksListPage() {
  const navigate = useNavigate();
  const projects = useProjects();
  const supportedEnvironments = useFeatureTaskEnvironments();
  const tasksQuery = useFeatureTasks();
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const environments = useMemo(() => tasksQuery.values, [tasksQuery.values]);
  const tasks = useMemo(
    () =>
      environments
        .flatMap(({ environmentId, tasks: items }) =>
          items
            .filter((task) => showArchived || task.archivedAt === null)
            .map((task) => ({ task, environmentId })),
        )
        .sort((left, right) => right.task.updatedAt.localeCompare(left.task.updatedAt)),
    [environments, showArchived],
  );
  const canCreate = projects.some((project) =>
    supportedEnvironments.includes(project.environmentId),
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={false}>
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <ListChecksIcon className="size-4" />
          <span className="font-medium text-foreground">Tasks</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowArchived((value) => !value)}>
            <ArchiveIcon />
            {showArchived ? "Hide archived" : "Archived"}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!canCreate}>
            <PlusIcon />
            New task
          </Button>
        </div>
      </WorkspacePageHeader>
      <WorkspacePageContainer width="wide" className="min-h-0 flex-1 overflow-y-auto pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Work that outlives a chat
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Objectives, decisions, and next steps stay attached to the work.
            </p>
          </div>
          <span className="pb-1 text-xs text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        </div>
        {tasksQuery.error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
          >
            Could not load tasks from one or more workspaces. {tasksQuery.error}
            <Button size="sm" variant="ghost" className="ml-2" onClick={tasksQuery.refresh}>
              Retry
            </Button>
          </div>
        ) : null}
        {tasksQuery.isPending && tasks.length === 0 ? (
          <div className="grid min-h-44 place-items-center text-sm text-muted-foreground">
            Loading tasks…
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border/80 px-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto grid size-10 place-items-center rounded-xl border bg-card text-muted-foreground">
                <ListChecksIcon className="size-5" />
              </div>
              <h2 className="mt-3 text-base font-semibold">
                {showArchived ? "No archived tasks" : "Start with a durable goal"}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {showArchived
                  ? "Archived tasks will appear here."
                  : "Create a task to keep its objective, decisions, and next action available across conversations."}
              </p>
              {!showArchived && canCreate ? (
                <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                  <PlusIcon />
                  Create a task
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            {tasks.map(({ task, environmentId }) => (
              <button
                key={`${environmentId}:${task.id}`}
                type="button"
                onClick={() =>
                  void navigate({
                    to: "/tasks/$environmentId/$taskId",
                    params: { environmentId, taskId: task.id },
                  })
                }
                className="group flex w-full items-start gap-3 rounded-xl border border-border/70 bg-card px-4 py-3.5 text-left transition-colors hover:border-border hover:bg-muted/30 active:bg-muted/50"
              >
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground">
                  <CircleDashedIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {task.title}
                    </span>
                    <TaskStatus status={task.status} />
                    {task.archivedAt ? (
                      <span className="rounded border px-1.5 py-0.5 text-3xs text-muted-foreground">
                        Archived
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {task.objective}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground/80">
                    <span>{projectName(projects, environmentId, task.projectId)}</span>
                    <span>
                      {task.threadIds.length}{" "}
                      {task.threadIds.length === 1 ? "conversation" : "conversations"}
                    </span>
                    <span>{formatUpdatedAt(task.updatedAt)}</span>
                  </span>
                </span>
                <ArrowUpRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
              </button>
            ))}
          </div>
        )}
      </WorkspacePageContainer>
      {createOpen ? (
        <TaskEditorDialog
          environmentId={supportedEnvironments[0] ?? ("" as EnvironmentId)}
          onClose={() => setCreateOpen(false)}
          onSaved={(task, environmentId) => {
            setCreateOpen(false);
            void navigate({
              to: "/tasks/$environmentId/$taskId",
              params: { environmentId, taskId: task.id },
            });
            tasksQuery.refresh();
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

export function TaskDetailPage({
  environmentId,
  taskId,
}: {
  readonly environmentId: EnvironmentId;
  readonly taskId: FeatureTaskId;
}) {
  const navigate = useNavigate();
  const query = useFeatureTask(environmentId, taskId);
  const liveTasks = useFeatureTasks();
  const task =
    liveTasks.values
      .find((entry) => entry.environmentId === environmentId)
      ?.tasks.find((entry) => entry.id === taskId) ?? query.task;
  const projects = useProjects();
  const threads = useThreadShells();
  const update = useUpdateFeatureTask();
  const readTask = useReadFeatureTask();
  const launchThread = useAtomCommand(orchestrationEnvironment.v2.launchThread, {
    label: "start task conversation",
  });
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkSelection, setLinkSelection] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const pendingLaunchRef = useRef<{
    readonly threadId: ThreadId;
    readonly commandId: ReturnType<typeof CommandId.make>;
    readonly launchInput: Omit<
      OrchestrationV2ThreadLaunchInput,
      "commandId" | "threadId" | "initialMessage"
    >;
  } | null>(null);
  const project = task
    ? projects.find((item) => item.environmentId === environmentId && item.id === task.projectId)
    : null;
  const serverSettings = useEnvironmentSettings(environmentId);
  const projectSettings = useMemo(
    () =>
      resolveProjectSettings(serverSettings, project?.id ?? null, project ?? undefined).settings,
    [project, serverSettings],
  );
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const providerEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), serverSettings),
      ),
    [providers, serverSettings],
  );
  const defaultModelSelection = useMemo(
    () => (project ? scheduledTaskDefaultModel(serverSettings, project, providerEntries) : null),
    [project, providerEntries, serverSettings],
  );
  const linkedThreads = useMemo(
    () =>
      task
        ? task.threadIds.map((threadId) => ({
            threadId,
            thread:
              threads.find(
                (thread) =>
                  thread.environmentId === environmentId &&
                  thread.id === threadId &&
                  thread.projectId === task.projectId,
              ) ?? null,
          }))
        : [],
    [environmentId, task, threads],
  );
  const candidates = useMemo(
    () =>
      task
        ? threads
            .filter(
              (thread) =>
                thread.environmentId === environmentId &&
                thread.projectId === task.projectId &&
                thread.deletedAt === null &&
                !task.threadIds.includes(thread.id),
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        : [],
    [environmentId, task, threads],
  );

  const taskConversationCommands = useMemo(
    () => ({
      getTask: async ({ id }: { id: FeatureTaskId }) => {
        const result = await readTask({ environmentId, input: { id } });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return result.value.task;
      },
      launchThread: async (input: OrchestrationV2ThreadLaunchInput) => {
        const result = await launchThread({ environmentId, input });
        if (result._tag === "Failure") {
          throw squashAtomCommandFailure(result);
        }
        return result.value;
      },
      updateTask: async (input: Parameters<typeof update>[0]["input"]) => {
        const result = await update({ environmentId, input });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        return result.value.task;
      },
    }),
    [environmentId, launchThread, readTask, update],
  );

  const refreshTask = query.refresh;
  const mutateTask = useCallback(
    async (patch: Parameters<typeof update>[0]["input"]["patch"]) => {
      if (!task || busy) return false;
      setBusy(true);
      const result = await update({
        environmentId,
        input: { id: task.id, expectedVersion: task.version, patch },
      });
      setBusy(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result))
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not update task",
              description: String(squashAtomCommandFailure(result)),
            }),
          );
        refreshTask();
        return false;
      }
      setLinkError(null);
      refreshTask();
      return true;
    },
    [busy, environmentId, refreshTask, task, update],
  );

  const startConversation = async () => {
    if (!task || busy || !project || task.archivedAt !== null) return;
    setBusy(true);
    const pendingLaunch = pendingLaunchRef.current;
    const launchIds = pendingLaunch ?? {
      threadId: newThreadId(),
      commandId: CommandId.make(randomUUID()),
    };
    const latestLinked = latestAvailableTaskThread(linkedThreads);
    const latestLinkedThread = latestLinked?.thread ?? null;
    const modelSelection = selectFeatureTaskConversationModel(
      latestLinkedThread,
      defaultModelSelection,
    );
    if (!modelSelection || !modelSelection.model.trim()) {
      if (!pendingLaunch) pendingLaunchRef.current = null;
      setBusy(false);
      setLinkError(
        "Choose an available provider and model in the conversation composer before starting task work.",
      );
      return;
    }
    const workspaceStrategy = latestLinkedThread?.worktreePath
      ? {
          type: "existing_worktree" as const,
          worktreePath: latestLinkedThread.worktreePath,
          ...(latestLinkedThread.branch ? { branch: latestLinkedThread.branch } : {}),
        }
      : {
          type: "root" as const,
          ...(latestLinkedThread?.branch ? { branch: latestLinkedThread.branch } : {}),
        };
    const launchInput = pendingLaunch?.launchInput ?? {
      projectId: task.projectId,
      title: task.title,
      generateTitle: false,
      modelSelection,
      runtimeMode: latestLinkedThread?.runtimeMode ?? projectSettings.defaultRuntimeMode,
      interactionMode: latestLinkedThread?.interactionMode ?? "default",
      workspaceStrategy,
    };
    pendingLaunchRef.current = { ...launchIds, launchInput };
    let result;
    try {
      result = await launchFeatureTaskConversation(taskConversationCommands, {
        taskId: task.id,
        threadId: launchIds.threadId,
        commandId: launchIds.commandId,
        launchInput,
      });
    } catch (error) {
      setBusy(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start conversation",
          description: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }
    pendingLaunchRef.current = null;
    setBusy(false);
    if (result.status === "needs_link") {
      setLinkError(
        `Conversation started (${result.launch.threadId}) but could not be linked. Retry linking it below.`,
      );
      setLinkSelection(result.launch.threadId);
      query.refresh();
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(environmentId, result.launch.threadId)),
    });
  };

  const linkSelected = async () => {
    if (!task || !linkSelection) return;
    setBusy(true);
    try {
      const linked = await linkFeatureTaskConversation(
        taskConversationCommands,
        task.id,
        linkSelection as ThreadId,
      );
      if (linked.status === "linked") {
        setLinkSelection("");
        setLinkError(null);
      } else {
        setLinkError(`Could not link this conversation. ${String(linked.error)}`);
      }
      query.refresh();
    } catch (error) {
      setLinkError(
        `Could not link this conversation. ${error instanceof Error ? error.message : String(error)}`,
      );
      query.refresh();
    } finally {
      setBusy(false);
    }
  };

  if ((query.isPending || liveTasks.isPending) && !task) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden">
        <WorkspacePageHeader>
          <span className="text-sm text-muted-foreground">Loading task…</span>
        </WorkspacePageHeader>
      </SidebarInset>
    );
  }
  if (!task) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden">
        <WorkspacePageHeader>
          <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/tasks" })}>
            <ArrowLeftIcon />
            Tasks
          </Button>
        </WorkspacePageHeader>
        <WorkspacePageContainer>
          <h1 className="text-xl font-semibold">Task unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This task may have been removed or its workspace is disconnected.
          </p>
          <Button variant="outline" onClick={query.refresh}>
            Retry
          </Button>
        </WorkspacePageContainer>
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader>
        <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/tasks" })}>
          <ArrowLeftIcon />
          Tasks
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {project?.title ?? "Workspace unavailable"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label="Edit task"
            onClick={() => setEditorOpen(true)}
          >
            <SquarePenIcon />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          {task.archivedAt ? (
            <Button
              size="sm"
              variant="outline"
              aria-label="Restore task"
              disabled={busy}
              onClick={() => void mutateTask({ archived: false })}
            >
              <RotateCcwIcon />
              <span className="hidden sm:inline">Restore</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              aria-label="Archive task"
              disabled={busy}
              onClick={() => void mutateTask({ archived: true })}
            >
              <ArchiveIcon />
              <span className="hidden sm:inline">Archive</span>
            </Button>
          )}
          {linkedThreads.some(({ thread }) => thread !== null) ? (
            <Button
              size="sm"
              onClick={() => {
                const latest = latestAvailableTaskThread(linkedThreads);
                if (latest)
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(scopeThreadRef(environmentId, latest.threadId)),
                  });
              }}
              aria-label="Resume task conversation"
              disabled={busy}
            >
              <MessageSquareTextIcon />
              <span className="hidden sm:inline">Resume</span>
            </Button>
          ) : task.threadIds.length === 0 ? (
            <Button
              size="sm"
              aria-label={busy ? "Starting conversation" : "Start conversation"}
              onClick={() => void startConversation()}
              disabled={
                busy ||
                !project ||
                task.archivedAt !== null ||
                (!defaultModelSelection && !linkedThreads.some(({ thread }) => thread !== null))
              }
            >
              <MessageSquareTextIcon />
              <span className="hidden sm:inline">{busy ? "Starting…" : "Start conversation"}</span>
            </Button>
          ) : null}
        </div>
      </WorkspacePageHeader>
      <WorkspacePageContainer width="wide" className="min-h-0 flex-1 overflow-y-auto pt-7">
        <header className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatus status={task.status} />
            {task.archivedAt ? (
              <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                Archived
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">{formatUpdatedAt(task.updatedAt)}</span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{task.title}</h1>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {task.objective}
          </p>
        </header>
        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="grid content-start gap-7">
            <TaskSection title="Acceptance criteria" icon={<CheckIcon className="size-4" />}>
              {task.acceptanceCriteria.length ? (
                <ul className="grid gap-2">
                  {task.acceptanceCriteria.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-relaxed">
                      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded border border-border/80 text-transparent">
                        <CheckIcon className="size-3" />
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No acceptance criteria added.</p>
              )}
            </TaskSection>
            <TaskSection title="Decisions" icon={<CircleDashedIcon className="size-4" />}>
              {task.decisions.length ? (
                <ul className="grid gap-2">
                  {task.decisions.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-relaxed">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Decisions will appear here as you make them.
                </p>
              )}
            </TaskSection>
            <TaskSection title="Next action">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {task.nextAction || (
                  <span className="text-muted-foreground">Add the next concrete step.</span>
                )}
              </p>
            </TaskSection>
            {task.handoff ? (
              <TaskSection title="Handoff">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {task.handoff}
                </p>
              </TaskSection>
            ) : null}
          </div>
          <aside className="grid content-start gap-6">
            <section className="rounded-xl border border-border/70 bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Conversations</h2>
                <span className="text-xs text-muted-foreground">{task.threadIds.length}</span>
              </div>
              <div className="mt-3 grid gap-2">
                {linkedThreads.length ? (
                  linkedThreads.map(({ threadId, thread }) => (
                    <div key={threadId} className="rounded-lg border border-border/70 px-3 py-2.5">
                      {thread ? (
                        <>
                          <button
                            type="button"
                            className="w-full truncate text-left text-sm font-medium hover:underline"
                            onClick={() =>
                              void navigate({
                                to: "/$environmentId/$threadId",
                                params: buildThreadRouteParams(
                                  scopeThreadRef(environmentId, threadId),
                                ),
                              })
                            }
                          >
                            {thread.title || "Untitled conversation"}
                          </button>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {formatUpdatedAt(thread.updatedAt)}
                          </span>
                          {resolveThreadCurrentPullRequestLink(thread.pullRequests) ? (
                            <a
                              className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:underline"
                              href={resolveThreadCurrentPullRequestLink(thread.pullRequests)?.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <span className="truncate">
                                {
                                  resolveThreadCurrentPullRequestLink(thread.pullRequests)
                                    ?.repository
                                }{" "}
                                #{resolveThreadCurrentPullRequestLink(thread.pullRequests)?.number}
                              </span>
                              <ArrowUpRightIcon className="size-3 shrink-0" />
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Conversation unavailable ({threadId.slice(0, 8)})
                        </span>
                      )}
                      <button
                        type="button"
                        className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                        disabled={busy}
                        onClick={() =>
                          void mutateTask({
                            threadIds: task.threadIds.filter((id) => id !== threadId),
                          })
                        }
                      >
                        Unlink
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No conversations linked yet.</p>
                )}
              </div>
              {linkedThreads.length > 0 && !linkedThreads.some(({ thread }) => thread !== null) ? (
                <p className="mt-3 rounded-lg bg-muted/45 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  None of the linked conversations are available in this workspace. Link an existing
                  conversation, or start a fresh one below to continue with this task.
                </p>
              ) : null}
              {candidates.length ? (
                <div className="mt-3 flex items-center gap-2">
                  <select
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24"
                    aria-label="Choose a conversation to link"
                    value={linkSelection}
                    onChange={(event) => setLinkSelection(event.currentTarget.value)}
                  >
                    <option value="">Link a conversation…</option>
                    {candidates.map((thread) => (
                      <option key={thread.id} value={thread.id}>
                        {thread.title || "Untitled conversation"}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !linkSelection}
                    onClick={() => void linkSelected()}
                  >
                    Link
                  </Button>
                </div>
              ) : null}
              {linkError ? (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {linkError}{" "}
                  {linkSelection ? (
                    <button
                      className="underline"
                      disabled={busy}
                      onClick={() => void linkSelected()}
                    >
                      Retry link
                    </button>
                  ) : null}
                </p>
              ) : null}
            </section>
            <section className="rounded-xl border border-border/70 bg-card p-4">
              <h2 className="text-sm font-semibold">Workspace</h2>
              <p className="mt-2 text-sm">{project?.title ?? "Workspace unavailable"}</p>
              <p className="mt-1 break-all font-mono text-2xs leading-relaxed text-muted-foreground">
                {project?.workspaceRoot ?? "The project is unavailable in this session."}
              </p>
            </section>
            {task.threadIds.length ? (
              <Button
                variant="outline"
                className="w-full"
                disabled={
                  busy ||
                  !project ||
                  task.archivedAt !== null ||
                  (!defaultModelSelection && !linkedThreads.some(({ thread }) => thread !== null))
                }
                onClick={() => void startConversation()}
              >
                <PlusIcon />
                New conversation for this task
              </Button>
            ) : null}
          </aside>
        </div>
      </WorkspacePageContainer>
      {editorOpen ? (
        <TaskEditorDialog
          environmentId={environmentId}
          projectId={task.projectId}
          task={task}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            query.refresh();
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

function TaskSection({
  title,
  icon,
  children,
}: {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function TaskStatus({ status }: { readonly status: FeatureTaskStatus }) {
  return (
    <span
      className={`rounded border px-2 py-0.5 text-2xs font-medium ${STATUS_META[status].className}`}
    >
      {STATUS_META[status].label}
    </span>
  );
}
