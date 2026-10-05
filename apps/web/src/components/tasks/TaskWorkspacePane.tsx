import { ChevronRightIcon, CopyIcon } from "lucide-react";
import type {
  EnvironmentId,
  FeatureTask,
  FeatureTaskWorkspaceBinding,
  FeatureTaskWorkspaceResult,
} from "@yantrix/contracts";
import {
  describeFeatureTaskError,
  describeFeatureTaskWorkspace,
  validateWorktreeAttachPath,
  type FeatureTaskWorkspaceAction,
} from "@yantrix/client-runtime/state/feature-task-workspace";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@yantrix/client-runtime/state/runtime";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import {
  useAttachFeatureTaskWorkspace,
  useEnsureFeatureTaskWorkspace,
} from "../../state/featureTasks";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { InspectorPane } from "./TaskInspector";
import type { WorkspacePaneState } from "./TaskInspector.state";
import type { InspectorHealth } from "./TaskInspector.logic";
import { worktreeBasename } from "./TaskInspector.logic";
import { TaskToneChip } from "./TaskToneChip";

/**
 * Focus belongs to the step the user just took. It is moved from the handler,
 * not an autofocus attribute, so remounting the pane (collapse, resize) never steals focus.
 */
function focusAttachInput() {
  requestAnimationFrame(() => document.getElementById("task-attach-path")?.focus());
}

const ACTION_LABEL: Record<FeatureTaskWorkspaceAction, string> = {
  prepare: "Set up workspace",
  restore: "Restore worktree",
  attach: "Use another worktree",
  recheck: "Check again",
};

/**
 * The task's own worktree and branch. Every repair is explicit: nothing here
 * moves, resets, or deletes work, and the server's message is shown as-is.
 */
export function TaskWorkspacePane({
  environmentId,
  task,
  workspace,
  health,
  error,
  isPending,
  archived,
  onRefresh,
  state,
}: {
  readonly state: WorkspacePaneState;
  readonly environmentId: EnvironmentId;
  readonly task: FeatureTask;
  readonly workspace: FeatureTaskWorkspaceResult | null;
  readonly health: InspectorHealth;
  /** Failure to inspect, as opposed to a workspace problem. */
  readonly error: string | null;
  readonly isPending: boolean;
  readonly archived: boolean;
  readonly onRefresh: () => void;
}) {
  const ensure = useEnsureFeatureTaskWorkspace();
  const attach = useAttachFeatureTaskWorkspace();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "worktree path" });
  const {
    running,
    setRunning,
    actionError,
    setActionError,
    attachStage,
    setAttachStage,
    attachPath,
    setAttachPath,
    attachInvalid,
    setAttachInvalid,
    detailsOpen,
    setDetailsOpen,
  } = state;

  const binding: FeatureTaskWorkspaceBinding | null = workspace?.binding ?? task.workspace ?? null;
  const description = workspace ? describeFeatureTaskWorkspace(workspace) : null;
  // A failed or waiting re-check keeps the previous report around. It is history, not current health.
  const unverified = health.kind === "stale" || health.kind === "checking";
  const healthy = health.kind === "known" && health.tone === "success";

  const run = async (action: FeatureTaskWorkspaceAction) => {
    if (running) return;
    if (action === "recheck") {
      setActionError(null);
      onRefresh();
      return;
    }
    if (action === "attach" && attachStage === "closed") {
      setAttachStage("input");
      focusAttachInput();
      return;
    }
    setRunning(action);
    setActionError(null);
    const result =
      action === "attach"
        ? await attach({ environmentId, input: { id: task.id, worktreePath: attachPath.trim() } })
        : await ensure({ environmentId, input: { id: task.id } });
    setRunning(null);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result))
        setActionError(describeFeatureTaskError(squashAtomCommandFailure(result)));
      onRefresh();
      return;
    }
    if (action === "attach") {
      setAttachStage("closed");
      setAttachPath("");
    }
    // The server can accept a request and still report the workspace as not ready.
    if (result.value.state !== "ready" && result.value.state !== "unbound") {
      setActionError(describeFeatureTaskWorkspace(result.value).detail);
    }
    onRefresh();
  };

  const submitReview = () => {
    const invalid = validateWorktreeAttachPath(attachPath, binding);
    setAttachInvalid(invalid);
    if (invalid === null) setAttachStage("confirm");
  };

  const actions = (description?.actions ?? []).filter(
    (action) => action === "recheck" || (!archived && !unverified),
  );

  const footer =
    attachStage === "input" ? (
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!attachPath.trim()} onClick={submitReview}>
          Review
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setAttachStage("closed");
            setAttachInvalid(null);
          }}
        >
          Cancel
        </Button>
      </div>
    ) : attachStage === "confirm" ? (
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={running !== null} onClick={() => void run("attach")}>
          {running === "attach" ? <Spinner /> : null}
          Attach worktree
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={running !== null}
          onClick={() => {
            setAttachStage("input");
            focusAttachInput();
          }}
        >
          Back
        </Button>
      </div>
    ) : actions.length > 0 || (!workspace && error) ? (
      <div className="flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <Button
            key={action}
            size="xs"
            variant={
              healthy || action === "recheck" ? "ghost-muted" : index === 0 ? "default" : "outline"
            }
            disabled={running !== null || (action !== "recheck" && isPending)}
            onClick={() => void run(action)}
          >
            {running === action ? <Spinner /> : null}
            {ACTION_LABEL[action]}
          </Button>
        ))}
        {!workspace && error ? (
          <Button size="xs" variant="outline" onClick={onRefresh}>
            Retry
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <InspectorPane footer={footer}>
      <div className="flex items-center gap-2">
        <TaskToneChip tone={health.tone}>{health.label}</TaskToneChip>
        {health.kind === "checking" ? <Spinner size="xs" tone="muted" /> : null}
      </div>
      {health.kind === "checking" && workspace ? (
        <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Checking the workspace. Starting work is paused until this finishes.
        </p>
      ) : null}
      {workspace?.dependencies && workspace.dependencies.length > 0 ? (
        <div className="mt-3 grid gap-2" aria-label="Prerequisite status">
          <p className="text-xs font-medium">Prerequisites</p>
          {workspace.dependencies.map((item) => (
            <div key={item.id} className="grid gap-1 text-xs">
              <span className="font-medium">{item.title}</span>
              <span className="text-muted-foreground">
                {unverified ? "Last known: " : ""}
                {item.message}
              </span>
              {item.pullRequestUrl ? (
                <a
                  href={item.pullRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  View pull request
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {binding ? (
        <dl className="mt-3 grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Worktree</dt>
          <dd className="min-w-0 break-words font-medium">
            {worktreeBasename(binding.worktreePath)}
          </dd>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="min-w-0 break-all font-mono text-2xs leading-relaxed">{binding.branch}</dd>
        </dl>
      ) : null}
      {description && !unverified && !healthy && workspace?.state !== "dependencies_blocked" ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{description.detail}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          Could not check the workspace. {describeFeatureTaskError(error)}
          {health.kind === "stale" ? " Starting work is paused until it can be checked." : ""}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          {actionError}
        </p>
      ) : null}
      {attachStage === "input" ? (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitReview();
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor="task-attach-path">
            Absolute path of an existing worktree for this repository
          </label>
          <Input
            id="task-attach-path"
            font="mono"
            size="sm"
            value={attachPath}
            aria-invalid={attachInvalid !== null}
            aria-describedby={attachInvalid ? "task-attach-error" : undefined}
            onChange={(event) => {
              setAttachPath(event.currentTarget.value);
              setAttachInvalid(null);
            }}
            placeholder={binding?.repoPath ?? "/path/to/worktree"}
          />
          {attachInvalid ? (
            <p id="task-attach-error" role="alert" className="text-xs text-destructive">
              {attachInvalid}
            </p>
          ) : null}
        </form>
      ) : null}
      {attachStage === "confirm" ? (
        <div className="mt-4 grid gap-2" role="group" aria-label="Confirm worktree change">
          <p className="break-all font-mono text-2xs">{attachPath.trim()}</p>
          <ul className="grid list-disc gap-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>New conversations for this task will run here.</li>
            <li>Existing conversations are not moved.</li>
            <li>
              The server checks that this is a worktree of the same repository and that every linked
              conversation matches the chosen worktree and branch. It refuses otherwise.
            </li>
            <li>Nothing is deleted or reset.</li>
          </ul>
        </div>
      ) : null}
      {binding ? (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-4">
          <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRightIcon
              className={`size-3.5 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
            />
            Details
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-2 grid gap-2 pl-4.5">
              <div>
                <p className="text-2xs text-muted-foreground">Worktree path</p>
                <p className="mt-0.5 break-all font-mono text-2xs leading-relaxed">
                  {binding.worktreePath}
                </p>
              </div>
              <div>
                <p className="text-2xs text-muted-foreground">Repository</p>
                <p className="mt-0.5 break-all font-mono text-2xs leading-relaxed">
                  {binding.repoPath}
                </p>
              </div>
              <Button
                size="xs"
                variant="outline"
                className="w-fit"
                onClick={() => copyToClipboard(binding.worktreePath)}
              >
                <CopyIcon />
                {isCopied ? "Copied" : "Copy path"}
              </Button>
            </div>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </InspectorPane>
  );
}

/** Hosts without task workspaces: the project folder, plus a clear notice if the task owns a workspace. */
export function TaskLegacyWorkspacePane({
  projectTitle,
  workspaceRoot,
  binding,
}: {
  readonly projectTitle: string | undefined;
  readonly workspaceRoot: string | undefined;
  readonly binding: FeatureTaskWorkspaceBinding | null;
}) {
  return (
    <InspectorPane>
      <p className="text-sm">{projectTitle ?? "Workspace unavailable"}</p>
      <p className="mt-1 break-all font-mono text-2xs leading-relaxed text-muted-foreground">
        {workspaceRoot ?? "The project is unavailable in this session."}
      </p>
      {binding ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          This task has its own workspace, but this server cannot verify it. Update the server to
          start or resume work.
        </p>
      ) : null}
    </InspectorPane>
  );
}
