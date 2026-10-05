import { ArrowUpRightIcon } from "lucide-react";
import type { FeatureTaskDelivery } from "@yantrix/contracts";
import {
  describeFeatureTaskDelivery,
  describeFeatureTaskError,
} from "@yantrix/client-runtime/state/feature-task-workspace";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { InspectorPane } from "./TaskInspector";
import { TaskToneChip } from "./TaskToneChip";

/**
 * Pull request, aggregate checks, and merge state as the host reports them.
 * This is deliberately separate from the task's progress status, which is only a note.
 */
export function TaskDeliveryPane({
  delivery,
  hasWorkspace,
  error,
  isPending,
  onRefresh,
}: {
  readonly delivery: FeatureTaskDelivery | null;
  /** False until the task owns a worktree and branch; there is nothing to look up before that. */
  readonly hasWorkspace: boolean;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly onRefresh: () => void;
}) {
  const description = delivery ? describeFeatureTaskDelivery(delivery) : null;
  // A failed refresh keeps the previous facts around; they are no longer current.
  // While refreshing, the cached facts are history too.
  const stale = delivery !== null && (error !== null || isPending);
  const checking = delivery !== null && error === null && isPending;
  return (
    <InspectorPane
      footer={
        <Button
          size="xs"
          variant="ghost-muted"
          aria-label="Refresh delivery state"
          disabled={isPending}
          onClick={onRefresh}
        >
          {isPending ? <Spinner /> : null}
          Refresh
        </Button>
      }
    >
      {description && delivery ? (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskToneChip tone={stale ? "unknown" : description.tone}>
              {description.headline}
            </TaskToneChip>
            {description.checks ? (
              <TaskToneChip tone={description.checks.tone}>{description.checks.label}</TaskToneChip>
            ) : null}
            {description.merge ? (
              <TaskToneChip tone={description.merge.tone}>{description.merge.label}</TaskToneChip>
            ) : null}
          </div>
          {delivery.pullRequest ? (
            <>
              <a
                className="flex items-start gap-1.5 text-sm text-primary hover:underline"
                href={delivery.pullRequest.url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="min-w-0 break-words">{delivery.pullRequest.title}</span>
                <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0" />
              </a>
              <p className="break-all font-mono text-2xs leading-relaxed text-muted-foreground">
                {delivery.pullRequest.headBranch} into {delivery.pullRequest.baseBranch}
              </p>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {!hasWorkspace
                ? "Set up the task workspace to check delivery. A pull request is looked up from the task's branch."
                : delivery.updatedAt === null
                  ? "Delivery state could not be read from the host."
                  : "Open a pull request from this task's branch to track checks and merging here."}
            </p>
          )}
          {checking ? (
            <p role="status" className="text-xs text-muted-foreground">
              Checking delivery. Showing the last known state.
            </p>
          ) : null}
          <p className="text-2xs text-muted-foreground">
            {stale
              ? delivery.updatedAt
                ? `Last known, checked ${formatRelativeTimeLabel(delivery.updatedAt)}`
                : "Last known, time unavailable"
              : delivery.updatedAt
                ? `Checked ${formatRelativeTimeLabel(delivery.updatedAt)}`
                : "Not checked yet"}
          </p>
        </div>
      ) : isPending ? (
        <p className="text-xs text-muted-foreground">Loading delivery state…</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          Could not load delivery state. {describeFeatureTaskError(error)}
        </p>
      ) : null}
    </InspectorPane>
  );
}
