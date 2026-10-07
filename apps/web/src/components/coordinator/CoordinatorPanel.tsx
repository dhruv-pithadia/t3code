import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@yantrix/client-runtime/environment";
import {
  deriveCoordinatorAttention,
  describeCoordinatorError,
  describeCoordinatorRequest,
  notificationKindLabel,
  sortCoordinatorRequests,
} from "@yantrix/client-runtime/state/project-coordinator";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectCoordinatorNotification,
  ProjectCoordinatorRequest,
  ProjectCoordinatorSnapshot,
} from "@yantrix/contracts";
import { ChevronDownIcon, ChevronRightIcon, WorkflowIcon } from "lucide-react";
import { memo, useCallback, useId, useMemo, useState } from "react";

import { useObserveCoordinatorNotification } from "../../state/projectCoordinator";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

const VISIBLE_REQUESTS = 5;
const VISIBLE_DECISIONS = 5;

type RequestTone = ReturnType<typeof describeCoordinatorRequest>["tone"];

const BADGE_VARIANT: Record<RequestTone, "outline" | "info" | "success" | "warning"> = {
  neutral: "outline",
  progress: "info",
  success: "success",
  warning: "warning",
};

const LINK_CLASS =
  "rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** Source message ids are evidence references, shown short and never as a claim about content. */
const shortId = (id: string) => (id.length > 8 ? id.slice(-8) : id);

function WorkLinks({
  environmentId,
  taskId,
  workerThreadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly taskId: ProjectCoordinatorRequest["taskId"];
  readonly workerThreadId: ProjectCoordinatorRequest["workerThreadId"];
}) {
  if (taskId === null && workerThreadId === null) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {workerThreadId !== null ? (
        <Link
          to="/$environmentId/$threadId"
          params={buildThreadRouteParams(scopeThreadRef(environmentId, workerThreadId))}
          className={LINK_CLASS}
        >
          Open worker chat
        </Link>
      ) : null}
      {taskId !== null ? (
        <Link
          to="/tasks/$environmentId/$taskId"
          params={{ environmentId, taskId }}
          className={LINK_CLASS}
        >
          View task
        </Link>
      ) : null}
    </span>
  );
}

function RequestRow({
  environmentId,
  request,
}: {
  readonly environmentId: EnvironmentId;
  readonly request: ProjectCoordinatorRequest;
}) {
  const presentation = describeCoordinatorRequest(request);
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 line-clamp-2 break-words text-sm text-foreground">{request.text}</p>
        <Badge variant={BADGE_VARIANT[presentation.tone]} size="sm">
          {presentation.label}
        </Badge>
      </div>
      {presentation.detail ? (
        <p
          className={
            presentation.tone === "warning"
              ? "break-words text-xs text-warning-foreground"
              : "break-words text-xs text-muted-foreground"
          }
        >
          {presentation.detail}
        </p>
      ) : null}
      <WorkLinks
        environmentId={environmentId}
        taskId={request.taskId}
        workerThreadId={request.workerThreadId}
      />
    </li>
  );
}

function NotificationRow({
  environmentId,
  notification,
  busy,
  onObserve,
}: {
  readonly environmentId: EnvironmentId;
  readonly notification: ProjectCoordinatorNotification;
  readonly busy: boolean;
  readonly onObserve: (id: string) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">
            {notificationKindLabel(notification.kind)}
          </p>
          <p className="break-words text-sm text-muted-foreground">{notification.summary}</p>
        </div>
        {notification.observedAt === null ? (
          <Button
            size="xs"
            variant="outline"
            disabled={busy}
            onClick={() => onObserve(notification.id)}
          >
            Mark seen
          </Button>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Seen</span>
        )}
      </div>
      <WorkLinks
        environmentId={environmentId}
        taskId={notification.taskId}
        workerThreadId={notification.workerThreadId}
      />
    </li>
  );
}

function SectionHeading({ children }: { readonly children: React.ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>;
}

/**
 * Compact project state above the coordinator conversation: what needs the
 * user, how each request was routed, and the decisions on record. The chat
 * itself stays the ordinary thread view.
 */
export const CoordinatorPanel = memo(function CoordinatorPanel({
  environmentId,
  snapshot,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: ProjectCoordinatorSnapshot;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [showAllDecisions, setShowAllDecisions] = useState(false);
  const [observing, setObserving] = useState<ReadonlySet<string>>(() => new Set());
  const observe = useObserveCoordinatorNotification();
  const regionId = useId();

  const attention = useMemo(() => deriveCoordinatorAttention(snapshot), [snapshot]);
  const requests = useMemo(() => sortCoordinatorRequests(snapshot.requests), [snapshot.requests]);
  const visibleRequests = showAllRequests ? requests : requests.slice(0, VISIBLE_REQUESTS);
  const visibleDecisions = showAllDecisions
    ? snapshot.decisions
    : snapshot.decisions.slice(0, VISIBLE_DECISIONS);

  const observeNotification = useCallback(
    async (id: string) => {
      setObserving((current) => new Set(current).add(id));
      const result = await observe({
        environmentId,
        input: { projectId: snapshot.projectId, id },
      });
      setObserving((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (result._tag === "Failure") {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not mark as seen",
            description: describeCoordinatorError(squashAtomCommandFailure(result)),
          }),
        );
      }
    },
    [environmentId, observe, snapshot.projectId],
  );

  const activeCount = attention.activeRequests.length;
  const hasContent =
    requests.length > 0 || snapshot.decisions.length > 0 || attention.attentionCount > 0;

  return (
    <section
      aria-label="Coordinator status"
      className="shrink-0 border-b border-border bg-background pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setExpanded((value) => !value)}
        className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-sm py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {expanded ? (
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <WorkflowIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium text-foreground">Project status</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {attention.attentionCount > 0 ? (
            <Badge variant="warning" size="sm">
              {attention.attentionCount} need{attention.attentionCount === 1 ? "s" : ""} attention
            </Badge>
          ) : null}
          {activeCount > 0 ? (
            <Badge variant="info" size="sm">
              {activeCount} in progress
            </Badge>
          ) : null}
          {!hasContent ? (
            <span className="truncate text-xs text-muted-foreground">Nothing yet</span>
          ) : null}
        </span>
      </button>
      <div
        id={regionId}
        hidden={!expanded}
        className="max-h-[40dvh] overflow-y-auto overscroll-contain pb-3"
      >
        {expanded ? (
          <div className="flex flex-col gap-3">
            {attention.openNotifications.length > 0 ? (
              <div>
                <SectionHeading>Needs attention</SectionHeading>
                <ul className="divide-y divide-border">
                  {attention.openNotifications.map((notification) => (
                    <NotificationRow
                      key={notification.id}
                      environmentId={environmentId}
                      notification={notification}
                      busy={observing.has(notification.id)}
                      onObserve={observeNotification}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <SectionHeading>Requests</SectionHeading>
              {requests.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Messages you send here appear as requests with their status.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-border">
                    {visibleRequests.map((request) => (
                      <RequestRow
                        key={request.id}
                        environmentId={environmentId}
                        request={request}
                      />
                    ))}
                  </ul>
                  {requests.length > VISIBLE_REQUESTS ? (
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      onClick={() => setShowAllRequests((value) => !value)}
                    >
                      {showAllRequests
                        ? "Show fewer"
                        : `Show ${requests.length - VISIBLE_REQUESTS} more`}
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {snapshot.decisions.length > 0 ? (
              <div>
                <SectionHeading>Decisions</SectionHeading>
                <ul className="divide-y divide-border">
                  {visibleDecisions.map((decision) => (
                    <li key={decision.id} className="flex min-w-0 flex-col gap-0.5 py-2">
                      <p className="break-words text-sm text-foreground">{decision.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {decision.sourceMessageId
                          ? `Source message ${shortId(decision.sourceMessageId)}`
                          : "No source message"}
                      </p>
                    </li>
                  ))}
                </ul>
                {snapshot.decisions.length > VISIBLE_DECISIONS ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    onClick={() => setShowAllDecisions((value) => !value)}
                  >
                    {showAllDecisions
                      ? "Show fewer"
                      : `Show ${snapshot.decisions.length - VISIBLE_DECISIONS} more`}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
});
