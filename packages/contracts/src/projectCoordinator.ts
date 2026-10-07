import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { FeatureTaskId } from "./featureTask.ts";
import { ModelSelection } from "./modelSelection.ts";

const CoordinatorText = Schema.String.check(Schema.isMaxLength(32_000));
const CoordinatorSummary = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));
const CoordinatorId = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const ContextRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ProjectCoordinatorOpenInput = Schema.Struct({
  projectId: ProjectId,
  modelSelection: ModelSelection,
});
export type ProjectCoordinatorOpenInput = typeof ProjectCoordinatorOpenInput.Type;

export const ProjectCoordinatorReadInput = Schema.Struct({ projectId: ProjectId });
export type ProjectCoordinatorReadInput = typeof ProjectCoordinatorReadInput.Type;

export const ProjectCoordinatorSendInput = Schema.Struct({
  projectId: ProjectId,
  requestId: CoordinatorId,
  text: CoordinatorText,
});
export type ProjectCoordinatorSendInput = typeof ProjectCoordinatorSendInput.Type;

export const ProjectCoordinatorRouteInput = Schema.Struct({
  sourceMessageId: MessageId,
  kind: Schema.Literals(["discussion", "new_task", "follow_up"]),
  taskId: Schema.optional(FeatureTaskId),
  title: Schema.optional(CoordinatorSummary),
  objective: Schema.optional(CoordinatorText),
  acceptanceCriteria: Schema.optional(
    Schema.Array(CoordinatorSummary).check(Schema.isMaxLength(100)),
  ),
  decisions: Schema.optional(Schema.Array(CoordinatorSummary).check(Schema.isMaxLength(100))),
  nextAction: Schema.optional(CoordinatorText),
  handoff: Schema.optional(CoordinatorText),
});
export type ProjectCoordinatorRouteInput = typeof ProjectCoordinatorRouteInput.Type;

export const ProjectCoordinatorStartupPacket = Schema.Struct({
  contextRevision: ContextRevision,
  decisions: Schema.Array(Schema.Struct({ id: CoordinatorId, text: CoordinatorSummary })),
});
export type ProjectCoordinatorStartupPacket = typeof ProjectCoordinatorStartupPacket.Type;

export const ProjectCoordinatorDecisionInput = Schema.Struct({
  projectId: ProjectId,
  id: CoordinatorId,
  text: CoordinatorSummary,
  sourceMessageId: MessageId,
  expectedContextRevision: ContextRevision,
});
export type ProjectCoordinatorDecisionInput = typeof ProjectCoordinatorDecisionInput.Type;

export const ProjectCoordinatorQuestionInput = Schema.Struct({
  projectId: ProjectId,
  id: CoordinatorId,
  sourceMessageId: MessageId,
  summary: CoordinatorSummary,
});
export type ProjectCoordinatorQuestionInput = typeof ProjectCoordinatorQuestionInput.Type;

export const ProjectCoordinatorDecision = Schema.Struct({
  id: CoordinatorId,
  text: CoordinatorSummary,
  sourceMessageId: Schema.NullOr(MessageId),
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectCoordinatorDecision = typeof ProjectCoordinatorDecision.Type;

export const ProjectCoordinatorRequestStatus = Schema.Literals([
  "pending",
  "discussed",
  "dispatching",
  "dispatched",
  "blocked",
]);
export type ProjectCoordinatorRequestStatus = typeof ProjectCoordinatorRequestStatus.Type;

export const ProjectCoordinatorRequest = Schema.Struct({
  id: CoordinatorId,
  projectId: ProjectId,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sourceMessageId: MessageId,
  text: CoordinatorText,
  status: ProjectCoordinatorRequestStatus,
  route: Schema.NullOr(Schema.Literals(["discussion", "new_task", "follow_up"])),
  taskId: Schema.NullOr(FeatureTaskId),
  workerThreadId: Schema.NullOr(ThreadId),
  commandId: Schema.NullOr(CommandId),
  routePayload: Schema.NullOr(
    Schema.Struct({
      route: ProjectCoordinatorRouteInput,
      startupPacket: Schema.NullOr(ProjectCoordinatorStartupPacket),
    }),
  ),
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectCoordinatorRequest = typeof ProjectCoordinatorRequest.Type;

export const ProjectCoordinatorNotificationKind = Schema.Literals([
  "worker_completed",
  "worker_failed",
  "dispatch_blocked",
  "worker_waiting",
  "pending_decision",
]);
export type ProjectCoordinatorNotificationKind = typeof ProjectCoordinatorNotificationKind.Type;

export const ProjectCoordinatorNotification = Schema.Struct({
  id: CoordinatorId,
  taskId: Schema.NullOr(FeatureTaskId),
  workerThreadId: Schema.NullOr(ThreadId),
  sourceMessageId: Schema.NullOr(MessageId),
  runtimeRequestId: Schema.NullOr(TrimmedNonEmptyString),
  kind: ProjectCoordinatorNotificationKind,
  summary: CoordinatorSummary,
  status: Schema.Literals(["pending", "resolved"]),
  observedAt: Schema.NullOr(IsoDateTime),
  resolvedAt: Schema.NullOr(IsoDateTime),
  resolutionMessageId: Schema.NullOr(MessageId),
  createdAt: IsoDateTime,
});
export type ProjectCoordinatorNotification = typeof ProjectCoordinatorNotification.Type;

export const ProjectCoordinatorSnapshot = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  modelSelection: Schema.NullOr(ModelSelection),
  contextRevision: ContextRevision,
  decisions: Schema.Array(ProjectCoordinatorDecision),
  requests: Schema.Array(ProjectCoordinatorRequest),
  notifications: Schema.Array(ProjectCoordinatorNotification),
});
export type ProjectCoordinatorSnapshot = typeof ProjectCoordinatorSnapshot.Type;

export const ProjectCoordinatorSendResult = Schema.Struct({
  snapshot: ProjectCoordinatorSnapshot,
});
export type ProjectCoordinatorSendResult = typeof ProjectCoordinatorSendResult.Type;

export const ProjectCoordinatorObserveNotificationInput = Schema.Struct({
  projectId: ProjectId,
  id: CoordinatorId,
});
export type ProjectCoordinatorObserveNotificationInput =
  typeof ProjectCoordinatorObserveNotificationInput.Type;

export const ProjectCoordinatorResolveNotificationInput = Schema.Struct({
  projectId: ProjectId,
  id: CoordinatorId,
  resolutionMessageId: MessageId,
});
export type ProjectCoordinatorResolveNotificationInput =
  typeof ProjectCoordinatorResolveNotificationInput.Type;

export const ProjectCoordinatorEvidenceInput = Schema.Struct({
  projectId: ProjectId,
  sourceMessageId: Schema.optional(MessageId),
  notificationId: Schema.optional(CoordinatorId),
});
export type ProjectCoordinatorEvidenceInput = typeof ProjectCoordinatorEvidenceInput.Type;

export const ProjectCoordinatorEvidenceResult = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  contextRevision: ContextRevision,
  decisions: Schema.Array(ProjectCoordinatorDecision),
  requests: Schema.Array(
    Schema.Struct({
      id: CoordinatorId,
      sourceMessageId: MessageId,
      status: ProjectCoordinatorRequestStatus,
      taskId: Schema.NullOr(FeatureTaskId),
      workerThreadId: Schema.NullOr(ThreadId),
      error: Schema.NullOr(Schema.String),
    }),
  ),
  notifications: Schema.Array(
    Schema.Struct({
      id: CoordinatorId,
      kind: ProjectCoordinatorNotificationKind,
      status: Schema.Literals(["pending", "resolved"]),
      observedAt: Schema.NullOr(IsoDateTime),
      taskId: Schema.NullOr(FeatureTaskId),
      workerThreadId: Schema.NullOr(ThreadId),
    }),
  ),
  request: Schema.NullOr(ProjectCoordinatorRequest),
  notification: Schema.NullOr(ProjectCoordinatorNotification),
  omittedRequests: NonNegativeInt,
  omittedNotifications: NonNegativeInt,
});
export type ProjectCoordinatorEvidenceResult = typeof ProjectCoordinatorEvidenceResult.Type;

export class ProjectCoordinatorError extends Schema.TaggedError<ProjectCoordinatorError>()(
  "ProjectCoordinatorError",
  {
    code: Schema.Literals(["not_found", "conflict", "invalid_link", "storage"]),
    message: Schema.String,
    projectId: Schema.optional(ProjectId),
  },
) {}
