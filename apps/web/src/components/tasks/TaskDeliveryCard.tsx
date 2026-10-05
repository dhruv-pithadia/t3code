import { ArrowUpRightIcon } from "lucide-react";
import type { FeatureTaskDelivery } from "@yantrix/contracts";
import {
  describeFeatureTaskDelivery,
  describeFeatureTaskError,
} from "@yantrix/client-runtime/state/feature-task-workspace";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { TaskToneChip } from "./TaskToneChip";

/**
 * Pull request, checks, and merge state as the host reports them. This is
 * deliberately separate from the task's progress status, which is only a note.
 */
export function TaskDeliveryCard({
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
  const stale = error !== null && delivery !== null;
  return (
    <section
      className="rounded-xl border border-border/70 bg-card p-4"
      aria-labelledby="task-delivery-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="task-delivery-heading" className="text-sm font-semibold">
          Delivery
        </h2>
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
      </div>
      {description && delivery ? (
        <div className="mt-3 grid gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <TaskToneChip tone={description.tone}>{description.headline}</TaskToneChip>
            {description.checks ? (
              <TaskToneChip tone={description.checks.tone}>{description.checks.label}</TaskToneChip>
            ) : null}
            {description.merge ? (
              <TaskToneChip tone={description.merge.tone}>{description.merge.label}</TaskToneChip>
            ) : null}
          </div>
          {delivery.pullRequest ? (
            <a
              className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              href={delivery.pullRequest.url}
              target="_blank"
              rel="noreferrer"
            >
              <span className="truncate">{delivery.pullRequest.title}</span>
              <ArrowUpRightIcon className="size-3 shrink-0" />
            </a>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {!hasWorkspace
                ? "Set up the task workspace to check delivery. A pull request is looked up from the task's branch."
                : delivery.updatedAt === null
                  ? "Delivery state could not be read from the host."
                  : "Open a pull request from this task's branch to track checks and merging here."}
            </p>
          )}
          {delivery.pullRequest ? (
            <p className="font-mono text-2xs text-muted-foreground">
              {delivery.pullRequest.headBranch} into {delivery.pullRequest.baseBranch}
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
        <p className="mt-3 text-xs text-muted-foreground">Loading delivery state…</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs leading-relaxed text-destructive">
          Could not load delivery state. {describeFeatureTaskError(error)}
        </p>
      ) : null}
    </section>
  );
}
