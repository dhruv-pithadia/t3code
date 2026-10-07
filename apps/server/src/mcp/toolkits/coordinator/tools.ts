import {
  ProjectCoordinatorDecisionInput,
  ProjectCoordinatorObserveNotificationInput,
  ProjectCoordinatorEvidenceInput,
  ProjectCoordinatorEvidenceResult,
  ProjectCoordinatorQuestionInput,
  ProjectCoordinatorResolveNotificationInput,
  ProjectCoordinatorRouteInput,
  OrchestratorMcpFailure,
} from "@yantrix/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as Coordinator from "../../../project/ProjectCoordinatorService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  success: ProjectCoordinatorEvidenceResult,
  dependencies: [McpInvocationContext.McpInvocationContext, Coordinator.ProjectCoordinatorService],
};

const Read = Tool.make("yantrix_coordinator_read", {
  ...shared,
  parameters: ProjectCoordinatorEvidenceInput,
  description:
    "Read this calling project's native coordinator inbox, feature routing, current accepted product decisions and worker notifications. Read before correcting a decision to obtain the current contextRevision. Default results contain bounded identity references; pass sourceMessageId for one complete original request or notificationId for one complete question/notification. Project scope is checked against the calling provider thread.",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const Route = Tool.make("yantrix_coordinator_route", {
  ...shared,
  parameters: ProjectCoordinatorRouteInput,
  description:
    "Route a persisted user inbox sourceMessageId from the project's native coordinator conversation. Reason about actual intent: discussion answers an informational question without a coding task; new_task creates a durable task/worktree/real worker for authorized implementation; follow_up sends steering to the same existing feature worker. Provide taskId for follow_up. Generated objective/acceptanceCriteria are planning proposals; original user text remains separate durable intent. Stable source message identity makes retries idempotent. Result status dispatched means launch or message accepted, not implemented or completed. Only one active feature is supported. Never bypass a blocked route by manually launching another worker.",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true);

const Decision = Tool.make("yantrix_coordinator_record_decision", {
  ...shared,
  parameters: ProjectCoordinatorDecisionInput,
  description:
    "Record an explicit accepted product decision or correction supported by a persisted user sourceMessageId. Use a stable id for the same decision and the current expectedContextRevision from coordinator_read. This updates project direction supplied directly to future turns, including ordinary fresh conversations. Do not store assistant plans or inferred choices as user decisions. Accepted direction is not evidence that a worker applied it to code.",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const Observe = Tool.make("yantrix_coordinator_observe_notification", {
  ...shared,
  parameters: ProjectCoordinatorObserveNotificationInput,
  description:
    "Mark a persisted coordinator worker notification as observed. Observation acknowledges receipt only; it does not certify task completion, verification, or merge readiness.",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const Ask = Tool.make("yantrix_coordinator_ask", {
  ...shared,
  parameters: ProjectCoordinatorQuestionInput,
  description:
    "Preserve an unresolved product question, clarification, or choice supported by a user inbox sourceMessageId. Keep a stable id and a concise complete question in summary. It remains pending through completed investigation turns, reload, restart and observation until a later user answer explicitly resolves it. Ask the user naturally in coordinator chat too.",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

const Resolve = Tool.make("yantrix_coordinator_resolve", {
  ...shared,
  parameters: ProjectCoordinatorResolveNotificationInput,
  description:
    "Resolve a preserved product question using a later user inbox resolutionMessageId that answers it. An assistant plan, investigation result, observation, or the original question does not resolve it. Saving a product decision remains a separate explicit action.",
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ProjectCoordinatorToolkit = Toolkit.make(Read, Route, Decision, Observe, Ask, Resolve);
