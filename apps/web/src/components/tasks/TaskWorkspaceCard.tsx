import { useState } from "react";
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

import {
  useAttachFeatureTaskWorkspace,
  useEnsureFeatureTaskWorkspace,
} from "../../state/featureTasks";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { TaskToneChip } from "./TaskToneChip";

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
export function TaskWorkspaceCard({
  environmentId,
  task,
  workspace,
  error,
  isPending,
  archived,
  onRefresh,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: FeatureTask;
  readonly workspace: FeatureTaskWorkspaceResult | null;
  /** Failure to inspect, as opposed to a workspace problem. */
  readonly error: string | null;
  readonly isPending: boolean;
  readonly archived: boolean;
  readonly onRefresh: () => void;
}) {
  const ensure = useEnsureFeatureTaskWorkspace();
  const attach = useAttachFeatureTaskWorkspace();
  const [running, setRunning] = useState<FeatureTaskWorkspaceAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachStage, setAttachStage] = useState<"closed" | "input" | "confirm">("closed");
  const [attachPath, setAttachPath] = useState("");
  const [attachInvalid, setAttachInvalid] = useState<string | null>(null);
  const attachOpen = attachStage !== "closed";

  const binding: FeatureTaskWorkspaceBinding | null = workspace?.binding ?? task.workspace ?? null;
  const description = workspace ? describeFeatureTaskWorkspace(workspace) : null;
  // A failed re-check keeps the previous report around. It is history, not current health.
  const stale = error !== null && workspace !== null;
  // Reactive queries keep the previous report while they wait (for example for a reconnect).
  const checking = !stale && isPending && workspace !== null;
  const unverified = stale || checking;

  const run = async (action: FeatureTaskWorkspaceAction) => {
    if (running) return;
    if (action === "recheck") {
      setActionError(null);
      onRefresh();
      return;
    }
    if (action === "attach" && attachStage === "closed") {
      setAttachStage("input");
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

  return (
    <section
      className="rounded-xl border border-border/70 bg-card p-4"
      aria-labelledby="task-workspace-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="task-workspace-heading" className="text-sm font-semibold">
          Workspace
        </h2>
        {description ? (
          <TaskToneChip tone={stale ? "unknown" : checking ? "neutral" : description.tone}>
            {unverified ? `Last known: ${description.label}` : description.label}
          </TaskToneChip>
        ) : isPending ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="xs" tone="muted" />
            Checking
          </span>
        ) : null}
      </div>
      {binding ? (
        <dl className="mt-3 grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="mt-0.5 break-all font-mono text-2xs">{binding.branch}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Worktree</dt>
            <dd className="mt-0.5 break-all font-mono text-2xs leading-relaxed">
              {binding.worktreePath}
            </dd>
          </div>
        </dl>
      ) : null}
      {checking ? (
        <p role="status" className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Checking the workspace. Starting work is paused until this finishes.
        </p>
      ) : null}
      {description && !unverified ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{description.detail}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          Could not check the workspace. {describeFeatureTaskError(error)}
          {stale ? " Starting work is paused until it can be checked." : ""}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          {actionError}
        </p>
      ) : null}
      {attachStage === "input" ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const invalid = validateWorktreeAttachPath(attachPath, binding);
            setAttachInvalid(invalid);
            if (invalid === null) setAttachStage("confirm");
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor="task-attach-path">
            Absolute path of an existing worktree for this repository
          </label>
          <Input
            id="task-attach-path"
            font="mono"
            size="sm"
            autoFocus
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
          <div className="flex items-center gap-2">
            <Button size="sm" type="submit" disabled={!attachPath.trim()}>
              Review
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                setAttachStage("closed");
                setAttachInvalid(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
      {attachStage === "confirm" ? (
        <div
          className="mt-3 grid gap-2 rounded-lg bg-muted/45 p-3"
          role="group"
          aria-label="Confirm worktree change"
        >
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
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={running !== null} onClick={() => void run("attach")}>
              {running === "attach" ? <Spinner /> : null}
              Attach worktree
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={running !== null}
              onClick={() => setAttachStage("input")}
            >
              Back
            </Button>
          </div>
        </div>
      ) : null}
      {description && !attachOpen ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {description.actions
            .filter((action) => action === "recheck" || (!archived && !unverified))
            .map((action, index) => (
              <Button
                key={action}
                size="xs"
                variant={index === 0 && action !== "recheck" ? "default" : "outline"}
                disabled={running !== null || (action !== "recheck" && isPending)}
                onClick={() => void run(action)}
              >
                {running === action ? <Spinner /> : null}
                {ACTION_LABEL[action]}
              </Button>
            ))}
        </div>
      ) : null}
      {!workspace && error ? (
        <Button size="xs" variant="outline" className="mt-3" onClick={onRefresh}>
          Retry
        </Button>
      ) : null}
    </section>
  );
}
