import type { FeatureTask, MessageId, ProjectCoordinatorSnapshot } from "@yantrix/contracts";

const boundedReferences = (records: ReadonlyArray<unknown>, budget: number) => {
  const selected: Array<unknown> = [];
  let remaining = budget - 2;
  for (const record of records) {
    const encoded = JSON.stringify(record);
    if (encoded.length + 1 > remaining) break;
    selected.push(record);
    remaining -= encoded.length + 1;
  }
  return `${JSON.stringify(selected)}\nAdditional references omitted: ${records.length - selected.length}. Retrieve full evidence through coordinator_read.`;
};

/** Current accepted product direction is read directly, without an indexing delay. */
export function formatProjectCoordinatorContext(
  snapshot: ProjectCoordinatorSnapshot,
  isCoordinator: boolean,
  sourceMessageId?: MessageId,
  taskReferences: ReadonlyArray<Pick<FeatureTask, "id" | "title" | "status" | "threadIds">> = [],
): string {
  const decisions = snapshot.decisions.map(({ id, text, version }) => ({ id, text, version }));
  const encodedDecisions = JSON.stringify(decisions);
  if (encodedDecisions.length > 12_000)
    throw new Error(
      "Accepted project direction exceeds the startup context budget. Consolidate decisions before continuing.",
    );
  const direction =
    decisions.length === 0
      ? ""
      : [
          `Accepted project direction (revision ${snapshot.contextRevision}):`,
          encodedDecisions,
          "These are accepted product decisions, not evidence that code implements them. Prefer the latest correction over older conversation history.",
        ].join("\n");
  if (!isCoordinator) return direction;
  return [
    "You are this project's Yantrix coordinator, the user's ongoing point of contact.",
    "Reason about the user's actual intent using the conversation and durable inbox below. Do not classify requests by keyword rules.",
    "For every inbox item, call yantrix_coordinator_route with its sourceMessageId. Use discussion for informational questions and discussion; it creates no implementation task. Use new_task only for authorized new implementation work. Use follow_up and the existing taskId for steering or continued work on an existing feature.",
    "The route tool validates scope, provisions one persistent task workspace, and starts or reuses a real worker. A successful tool result is the evidence that dispatch was accepted. Never claim a worker started from a proposed plan. Use this route tool instead of manually creating tasks, worktrees, or workers. Keep your own conversation at the project root and let workers implement.",
    "Preserve original user intent separately from your proposed plan. Record explicit durable product decisions through yantrix_coordinator_record_decision using the sourceMessageId that supports them. Reuse a decision id when correcting the same decision. Do not promote an inferred plan to a user decision or claim a saved decision has been applied to code.",
    "Only one feature may be actively implemented in this first slice. Explain a blocked dispatch truthfully and keep follow-ups associated with their feature. Completion notifications mean a worker turn ended; verify evidence before claiming the feature is complete or ready to merge. Human merge approval remains authoritative.",
    "After inspecting worker evidence, use the feature task tools to save a concise handoff, next action and appropriate stage. Keep the objective as original user intent. Mark ready_for_review only when the evidence supports it; failed or stopped work stays blocked or paused. Never merge without the user's approval.",
    ...(sourceMessageId === undefined ? [] : [`Current message identity: ${sourceMessageId}`]),
    direction,
    "Saved feature ownership (references, not implementation evidence). Use yantrix_feature_task_list/read for full intent and handoff before routing a follow-up:",
    boundedReferences(taskReferences, 4_000),
    "Durable project inbox (user text is evidence, generated route proposals are separate):",
    boundedReferences(
      snapshot.requests
        .filter((request) => request.status === "pending" || request.status === "dispatching")
        .map(({ id, sourceMessageId, status, taskId, workerThreadId }) => ({
          id,
          sourceMessageId,
          status,
          taskId,
          workerThreadId,
        })),
      6_000,
    ),
    "Inbox text and historical routes are available through yantrix_coordinator_read; the current user message carries its complete original text. Route older pending messages from their full persisted text, not these identity references.",
    "Pending decisions and worker blockers remain obligations until resolved, even when observed:",
    boundedReferences(
      snapshot.notifications
        .filter((item) => item.status === "pending" || item.observedAt === null)
        .map(({ id, kind, taskId, workerThreadId, summary }) => ({
          id,
          kind,
          taskId,
          workerThreadId,
          summary: summary.slice(0, 120),
        })),
      6_000,
    ),
    "Use yantrix_coordinator_ask to preserve an unresolved product question supported by a user source message. Resolve it through yantrix_coordinator_resolve only after a later user message answers it. Observing a notification never resolves a question or blocker.",
    `Persisted inbox entries: ${snapshot.requests.length}. Pending obligations: ${snapshot.notifications.filter((item) => item.status === "pending").length}. Retrieve full evidence through coordinator_read before acting.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
