import {
  CommandId,
  FeatureTaskId,
  MessageId,
  ModelSelection,
  ProjectCoordinatorDecision,
  ProjectCoordinatorDecisionInput,
  ProjectCoordinatorError,
  ProjectCoordinatorNotification,
  ProjectCoordinatorNotificationKind,
  ProjectCoordinatorOpenInput,
  ProjectCoordinatorRequest,
  ProjectCoordinatorRequestStatus,
  ProjectCoordinatorResolveNotificationInput,
  ProjectCoordinatorRouteInput,
  ProjectCoordinatorSnapshot,
  ProjectCoordinatorStartupPacket,
  ProjectId,
  ThreadId,
} from "@yantrix/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type RouteKind = ProjectCoordinatorRouteInput["kind"];
type RoutePayload = {
  readonly route: ProjectCoordinatorRouteInput;
  readonly startupPacket: ProjectCoordinatorStartupPacket | null;
};

interface ProjectRow {
  readonly projectId: string;
  readonly threadId: string | null;
  readonly modelSelection: string | null;
  readonly contextRevision: number;
}

interface DecisionRow {
  readonly id: string;
  readonly text: string;
  readonly sourceMessageId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RequestRow {
  readonly id: string;
  readonly projectId: string;
  readonly sequence: number;
  readonly sourceMessageId: string;
  readonly text: string;
  readonly status: string;
  readonly route: string | null;
  readonly taskId: string | null;
  readonly workerThreadId: string | null;
  readonly commandId: string | null;
  readonly routePayload: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface NotificationRow {
  readonly id: string;
  readonly taskId: string | null;
  readonly workerThreadId: string | null;
  readonly sourceMessageId: string | null;
  readonly runtimeRequestId: string | null;
  readonly kind: string;
  readonly summary: string;
  readonly status: string;
  readonly observedAt: string | null;
  readonly resolvedAt: string | null;
  readonly resolutionMessageId: string | null;
  readonly createdAt: string;
}

const decode = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  Schema.decodeUnknownEffect(schema)(value);
const encodeJson = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  Schema.encodeSync(Schema.fromJsonString(schema))(value);
const decodeJson = <A, I>(schema: Schema.Codec<A, I>, value: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(value);
const isCoordinatorError = Schema.is(ProjectCoordinatorError);
const error = (code: ProjectCoordinatorError["code"], message: string, projectId?: ProjectId) =>
  new ProjectCoordinatorError({ code, message, ...(projectId === undefined ? {} : { projectId }) });
const storageError = (projectId?: ProjectId) =>
  error("storage", "Project coordinator storage failed.", projectId);
const nowIso = Effect.map(DateTime.now, (now) => DateTime.formatIso(DateTime.toUtc(now)));

const decodeDecisionRow = (row: DecisionRow) =>
  decode(ProjectCoordinatorDecision, {
    id: row.id,
    text: row.text,
    sourceMessageId: row.sourceMessageId,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

const decodeRequestRow = (row: RequestRow) =>
  Effect.gen(function* () {
    const routePayload =
      row.routePayload === null
        ? null
        : yield* decodeJson(
            Schema.Struct({
              route: ProjectCoordinatorRouteInput,
              startupPacket: Schema.NullOr(ProjectCoordinatorStartupPacket),
            }),
            row.routePayload,
          );
    return yield* decode(ProjectCoordinatorRequest, {
      id: row.id,
      projectId: row.projectId,
      sequence: row.sequence,
      sourceMessageId: row.sourceMessageId,
      text: row.text,
      status: row.status,
      route: row.route,
      taskId: row.taskId,
      workerThreadId: row.workerThreadId,
      commandId: row.commandId,
      routePayload,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  });

const decodeNotificationRow = (row: NotificationRow) =>
  decode(ProjectCoordinatorNotification, {
    id: row.id,
    taskId: row.taskId,
    workerThreadId: row.workerThreadId,
    sourceMessageId: row.sourceMessageId,
    runtimeRequestId: row.runtimeRequestId,
    kind: row.kind,
    summary: row.summary,
    status: row.status,
    observedAt: row.observedAt,
    resolvedAt: row.resolvedAt,
    resolutionMessageId: row.resolutionMessageId,
    createdAt: row.createdAt,
  });

export class ProjectCoordinatorStore extends Context.Service<
  ProjectCoordinatorStore,
  {
    readonly ensureProject: (
      input: ProjectCoordinatorOpenInput & { readonly threadId: ThreadId },
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly read: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly subscribe: (input: {
      readonly projectId: ProjectId;
    }) => Stream.Stream<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly readForThread: (threadId: ThreadId) => Effect.Effect<
      {
        readonly snapshot: ProjectCoordinatorSnapshot;
        readonly isCoordinator: boolean;
      } | null,
      ProjectCoordinatorError
    >;
    readonly recordRequest: (input: {
      readonly projectId: ProjectId;
      readonly id: string;
      readonly sourceMessageId: MessageId;
      readonly text: string;
    }) => Effect.Effect<ProjectCoordinatorRequest, ProjectCoordinatorError>;
    readonly getRequest: (input: {
      readonly projectId: ProjectId;
      readonly sourceMessageId: MessageId;
    }) => Effect.Effect<ProjectCoordinatorRequest | null, ProjectCoordinatorError>;
    readonly reserveRoute: (input: {
      readonly projectId: ProjectId;
      readonly sourceMessageId: MessageId;
      readonly route: RouteKind;
      readonly taskId: FeatureTaskId | null;
      readonly workerThreadId: ThreadId | null;
      readonly commandId: CommandId | null;
      readonly routePayload: RoutePayload;
    }) => Effect.Effect<ProjectCoordinatorRequest, ProjectCoordinatorError>;
    readonly markRequest: (input: {
      readonly projectId: ProjectId;
      readonly sourceMessageId: MessageId;
      readonly status: ProjectCoordinatorRequestStatus;
      readonly error?: string | null;
    }) => Effect.Effect<ProjectCoordinatorRequest, ProjectCoordinatorError>;
    readonly recordDecision: (
      input: ProjectCoordinatorDecisionInput,
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly recordNotification: (input: {
      readonly projectId: ProjectId;
      readonly id: string;
      readonly taskId: FeatureTaskId | null;
      readonly workerThreadId: ThreadId | null;
      readonly sourceMessageId?: MessageId | null;
      readonly runtimeRequestId?: string | null;
      readonly kind: ProjectCoordinatorNotificationKind;
      readonly summary: string;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly observeNotification: (input: {
      readonly projectId: ProjectId;
      readonly id: string;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly resolveNotification: (
      input: ProjectCoordinatorResolveNotificationInput,
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly listPendingDispatches: () => Effect.Effect<
      ReadonlyArray<ProjectCoordinatorRequest>,
      ProjectCoordinatorError
    >;
    readonly listRequestsForWorker: (
      workerThreadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<ProjectCoordinatorRequest>, ProjectCoordinatorError>;
  }
>()("yantrix/project/ProjectCoordinatorStore") {}

export const layer = Layer.effect(
  ProjectCoordinatorStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const changes = yield* PubSub.sliding<ProjectId>(64);
    const signalChange = (projectId: ProjectId) =>
      PubSub.publish(changes, projectId).pipe(Effect.asVoid);

    const readProjectRow = (projectId: ProjectId) =>
      sql<ProjectRow>`SELECT project_id AS projectId,
        coordinator_thread_id AS threadId, model_selection_json AS modelSelection,
        context_revision AS contextRevision
        FROM project_coordinator_projects WHERE project_id = ${projectId}`;

    const readSnapshot = Effect.fn("ProjectCoordinatorStore.readSnapshot")(function* (
      projectId: ProjectId,
    ) {
      const projectRows = yield* readProjectRow(projectId);
      const project = projectRows[0];
      if (project === undefined) {
        const projects = yield* sql`SELECT 1 FROM projection_projects
          WHERE project_id = ${projectId} AND deleted_at IS NULL`;
        if (projects.length === 0)
          return yield* error("not_found", "Project coordinator was not found.", projectId);
        return yield* decode(ProjectCoordinatorSnapshot, {
          projectId,
          threadId: null,
          modelSelection: null,
          contextRevision: 0,
          decisions: [],
          requests: [],
          notifications: [],
        });
      }
      if (project.modelSelection === null)
        return yield* error(
          "storage",
          "Project coordinator model selection is missing.",
          projectId,
        );
      const [modelSelection, decisionRows, requestRows, notificationRows] = yield* Effect.all([
        decodeJson(ModelSelection, project.modelSelection),
        sql<DecisionRow>`SELECT decision_id AS id, text,
          source_message_id AS sourceMessageId, version,
          created_at AS createdAt, updated_at AS updatedAt
          FROM project_coordinator_decisions WHERE project_id = ${projectId}
          ORDER BY updated_at ASC, decision_id ASC`,
        sql<RequestRow>`SELECT request_id AS id, project_id AS projectId, sequence,
          source_message_id AS sourceMessageId, original_user_text AS text, status, route,
          task_id AS taskId, worker_thread_id AS workerThreadId, command_id AS commandId,
          route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
          FROM project_coordinator_requests WHERE project_id = ${projectId}
          AND (status IN ('pending', 'dispatching') OR sequence IN (
            SELECT sequence FROM project_coordinator_requests WHERE project_id = ${projectId}
            ORDER BY sequence DESC LIMIT 100
          )) ORDER BY sequence ASC`,
        sql<NotificationRow>`SELECT notification_id AS id, task_id AS taskId,
          worker_thread_id AS workerThreadId, source_message_id AS sourceMessageId,
          runtime_request_id AS runtimeRequestId, kind, summary, status,
          observed_at AS observedAt, resolved_at AS resolvedAt,
          resolution_message_id AS resolutionMessageId,
          created_at AS createdAt FROM project_coordinator_notifications
          WHERE project_id = ${projectId}
          AND (status = 'pending' OR notification_id IN (
            SELECT notification_id FROM project_coordinator_notifications WHERE project_id = ${projectId}
            ORDER BY created_at DESC LIMIT 100
          ))
          ORDER BY observed_at IS NOT NULL, created_at DESC, notification_id`,
      ]);
      const decisions = yield* Effect.forEach(decisionRows, decodeDecisionRow);
      const requests = yield* Effect.forEach(requestRows, decodeRequestRow);
      const notifications = yield* Effect.forEach(notificationRows, decodeNotificationRow);
      return yield* decode(ProjectCoordinatorSnapshot, {
        projectId,
        threadId: project.threadId,
        modelSelection,
        contextRevision: project.contextRevision,
        decisions,
        requests,
        notifications,
      });
    });

    const read: ProjectCoordinatorStore["Service"]["read"] = ({ projectId }) =>
      readSnapshot(projectId).pipe(
        Effect.catch((cause) =>
          isCoordinatorError(cause)
            ? Effect.fail(cause)
            : Effect.logError("Project coordinator read failed", { cause, projectId }).pipe(
                Effect.andThen(Effect.fail(storageError(projectId))),
              ),
        ),
      );

    const ensureProject: ProjectCoordinatorStore["Service"]["ensureProject"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const projects = yield* sql<{
              readonly projectId: string;
            }>`SELECT project_id AS projectId
            FROM projection_projects WHERE project_id = ${input.projectId} AND deleted_at IS NULL`;
            if (projects.length === 0)
              return yield* error("invalid_link", "The workspace is unavailable.", input.projectId);
            const now = yield* nowIso;
            const modelSelection = encodeJson(ModelSelection, input.modelSelection);
            yield* sql`INSERT INTO project_coordinator_projects (
            project_id, coordinator_thread_id, model_selection_json, context_revision,
            request_sequence, created_at, updated_at
          ) VALUES (${input.projectId}, ${input.threadId}, ${modelSelection}, 0, 0, ${now}, ${now})
          ON CONFLICT(project_id) DO NOTHING`;
            const rows = yield* readProjectRow(input.projectId);
            const row = rows[0];
            if (row === undefined)
              return yield* error(
                "storage",
                "Project coordinator could not be initialized.",
                input.projectId,
              );
            if (row.threadId !== input.threadId)
              return yield* error(
                "conflict",
                "Project already has a coordinator thread.",
                input.projectId,
              );
            return yield* readSnapshot(input.projectId);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Project coordinator open failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const subscribe: ProjectCoordinatorStore["Service"]["subscribe"] = ({ projectId }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(read({ projectId })),
            Stream.fromSubscription(subscription).pipe(
              Stream.filter((changedProjectId) => changedProjectId === projectId),
              Stream.mapEffect(() => read({ projectId })),
            ),
          );
        }),
      );

    const readForThread: ProjectCoordinatorStore["Service"]["readForThread"] = (threadId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly projectId: string; readonly isCoordinator: number }>`
          SELECT threads.project_id AS projectId,
            CASE WHEN coordinator.coordinator_thread_id = threads.thread_id THEN 1 ELSE 0 END AS isCoordinator
          FROM orchestration_v2_projection_threads AS threads
          JOIN project_coordinator_projects AS coordinator ON coordinator.project_id = threads.project_id
          WHERE threads.thread_id = ${threadId}
        `;
        const row = rows[0];
        if (row === undefined) return null;
        return {
          snapshot: yield* readSnapshot(ProjectId.make(row.projectId)),
          isCoordinator: row.isCoordinator === 1,
        };
      }).pipe(
        Effect.catch((cause) =>
          isCoordinatorError(cause)
            ? Effect.fail(cause)
            : Effect.logError("Project coordinator thread lookup failed", { cause, threadId }).pipe(
                Effect.andThen(Effect.fail(storageError())),
              ),
        ),
      );

    const recordRequest: ProjectCoordinatorStore["Service"]["recordRequest"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const existing = yield* sql<RequestRow>`SELECT request_id AS id,
            project_id AS projectId, sequence, source_message_id AS sourceMessageId,
            original_user_text AS text, status, route, task_id AS taskId,
            worker_thread_id AS workerThreadId, command_id AS commandId,
            route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
            FROM project_coordinator_requests WHERE project_id = ${input.projectId}
            AND (request_id = ${input.id} OR source_message_id = ${input.sourceMessageId})`;
            if (existing[0] !== undefined) {
              const row = existing[0];
              if (
                row.id !== input.id ||
                row.sourceMessageId !== input.sourceMessageId ||
                row.text !== input.text
              )
                return yield* error(
                  "conflict",
                  "Coordinator request retry has different content.",
                  input.projectId,
                );
              return yield* decodeRequestRow(row);
            }
            const now = yield* nowIso;
            const sequenceRows = yield* sql<{
              readonly sequence: number;
            }>`UPDATE project_coordinator_projects
            SET request_sequence = request_sequence + 1, updated_at = ${now}
            WHERE project_id = ${input.projectId} RETURNING request_sequence AS sequence`;
            const sequence = sequenceRows[0]?.sequence;
            if (sequence === undefined)
              return yield* error(
                "not_found",
                "Project coordinator was not found.",
                input.projectId,
              );
            yield* sql`INSERT INTO project_coordinator_requests (
            project_id, request_id, sequence, source_message_id, original_user_text,
            status, route, task_id, worker_thread_id, command_id, route_payload_json,
            error, created_at, updated_at
          ) VALUES (${input.projectId}, ${input.id}, ${sequence}, ${input.sourceMessageId},
            ${input.text}, 'pending', NULL, NULL, NULL, NULL, NULL, NULL, ${now}, ${now})`;
            const rows = yield* sql<RequestRow>`SELECT request_id AS id,
            project_id AS projectId, sequence, source_message_id AS sourceMessageId,
            original_user_text AS text, status, route, task_id AS taskId,
            worker_thread_id AS workerThreadId, command_id AS commandId,
            route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
            FROM project_coordinator_requests WHERE project_id = ${input.projectId}
            AND request_id = ${input.id}`;
            const row = rows[0];
            if (row === undefined)
              return yield* error(
                "storage",
                "Coordinator request was not stored.",
                input.projectId,
              );
            return yield* decodeRequestRow(row);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator request persistence failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const getRequest: ProjectCoordinatorStore["Service"]["getRequest"] = (input) =>
      Effect.gen(function* () {
        const rows = yield* sql<RequestRow>`SELECT request_id AS id,
          project_id AS projectId, sequence, source_message_id AS sourceMessageId,
          original_user_text AS text, status, route, task_id AS taskId,
          worker_thread_id AS workerThreadId, command_id AS commandId,
          route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
          FROM project_coordinator_requests WHERE project_id = ${input.projectId}
          AND source_message_id = ${input.sourceMessageId}`;
        return rows[0] === undefined ? null : yield* decodeRequestRow(rows[0]);
      }).pipe(
        Effect.catch((cause) =>
          isCoordinatorError(cause)
            ? Effect.fail(cause)
            : Effect.logError("Coordinator request lookup failed", {
                cause,
                projectId: input.projectId,
              }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
        ),
      );

    const reserveRoute: ProjectCoordinatorStore["Service"]["reserveRoute"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const rows = yield* sql<RequestRow>`SELECT request_id AS id,
            project_id AS projectId, sequence, source_message_id AS sourceMessageId,
            original_user_text AS text, status, route, task_id AS taskId,
            worker_thread_id AS workerThreadId, command_id AS commandId,
            route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
            FROM project_coordinator_requests WHERE project_id = ${input.projectId}
            AND source_message_id = ${input.sourceMessageId}`;
            const current = rows[0];
            if (current === undefined)
              return yield* error(
                "not_found",
                "Coordinator request was not found.",
                input.projectId,
              );
            const routePayload = encodeJson(
              Schema.Struct({
                route: ProjectCoordinatorRouteInput,
                startupPacket: Schema.NullOr(ProjectCoordinatorStartupPacket),
              }),
              input.routePayload,
            );
            const targetStatus = input.route === "discussion" ? "discussed" : "dispatching";
            if (
              current.status === "dispatching" ||
              current.status === "dispatched" ||
              current.status === "discussed"
            ) {
              if (
                current.commandId === input.commandId &&
                current.routePayload === routePayload &&
                current.route === input.route &&
                current.taskId === input.taskId &&
                current.workerThreadId === input.workerThreadId
              )
                return yield* decodeRequestRow(current);
              return yield* error(
                "conflict",
                "Coordinator request already has a different route.",
                input.projectId,
              );
            }
            if (current.status !== "pending" && current.status !== "discussed")
              return yield* error(
                "conflict",
                "Coordinator request cannot be routed in its current state.",
                input.projectId,
              );
            const now = yield* nowIso;
            const updated = yield* sql<RequestRow>`UPDATE project_coordinator_requests SET
            status = ${targetStatus}, route = ${input.route}, task_id = ${input.taskId},
            worker_thread_id = ${input.workerThreadId}, command_id = ${input.commandId},
            route_payload_json = ${routePayload}, error = NULL, updated_at = ${now}
            WHERE project_id = ${input.projectId} AND source_message_id = ${input.sourceMessageId}
            AND status IN ('pending', 'discussed')
            RETURNING request_id AS id, project_id AS projectId, sequence,
            source_message_id AS sourceMessageId, original_user_text AS text, status, route,
            task_id AS taskId, worker_thread_id AS workerThreadId, command_id AS commandId,
            route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt`;
            if (updated[0] === undefined)
              return yield* error(
                "conflict",
                "Coordinator request changed before route reservation.",
                input.projectId,
              );
            return yield* decodeRequestRow(updated[0]);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator route reservation failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const markRequest: ProjectCoordinatorStore["Service"]["markRequest"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const current = yield* sql<{
              readonly status: string;
              readonly error: string | null;
            }>`SELECT status, error
            FROM project_coordinator_requests WHERE project_id = ${input.projectId}
            AND source_message_id = ${input.sourceMessageId}`;
            const currentRow = current[0];
            if (currentRow === undefined)
              return yield* error(
                "not_found",
                "Coordinator request was not found.",
                input.projectId,
              );
            if (currentRow.status === input.status && currentRow.error === (input.error ?? null)) {
              const currentRequest = yield* getRequest(input);
              if (currentRequest !== null) return currentRequest;
            }
            const transitions: Readonly<Record<string, ReadonlyArray<string>>> = {
              pending: ["pending", "discussed", "dispatching", "blocked"],
              discussed: ["discussed", "dispatching", "blocked"],
              dispatching: ["dispatching", "dispatched", "blocked"],
              blocked: ["blocked", "dispatching"],
              dispatched: ["dispatched", "blocked"],
            };
            if (!(transitions[currentRow.status] ?? []).includes(input.status))
              return yield* error(
                "conflict",
                "Coordinator request cannot move to that state.",
                input.projectId,
              );
            const now = yield* nowIso;
            const rows = yield* sql<RequestRow>`UPDATE project_coordinator_requests SET
            status = ${input.status}, error = ${input.error ?? null}, updated_at = ${now}
            WHERE project_id = ${input.projectId} AND source_message_id = ${input.sourceMessageId}
            AND status = ${currentRow.status}
            RETURNING request_id AS id, project_id AS projectId, sequence,
            source_message_id AS sourceMessageId, original_user_text AS text, status, route,
            task_id AS taskId, worker_thread_id AS workerThreadId, command_id AS commandId,
            route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt`;
            if (rows[0] === undefined)
              return yield* error("storage", "Coordinator request update failed.", input.projectId);
            return yield* decodeRequestRow(rows[0]);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator request update failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const recordDecision: ProjectCoordinatorStore["Service"]["recordDecision"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const stateRows = yield* sql<{
              readonly contextRevision: number;
            }>`SELECT context_revision AS contextRevision
            FROM project_coordinator_projects WHERE project_id = ${input.projectId}`;
            const currentRevision = stateRows[0]?.contextRevision;
            if (currentRevision === undefined)
              return yield* error(
                "not_found",
                "Project coordinator was not found.",
                input.projectId,
              );
            const currentRows = yield* sql<DecisionRow>`SELECT decision_id AS id, text,
            source_message_id AS sourceMessageId, version,
            created_at AS createdAt, updated_at AS updatedAt
            FROM project_coordinator_decisions WHERE project_id = ${input.projectId}
            AND decision_id = ${input.id}`;
            const current = currentRows[0];
            if (
              current !== undefined &&
              current.text === input.text &&
              current.sourceMessageId === input.sourceMessageId
            ) {
              return yield* readSnapshot(input.projectId);
            }
            if (currentRevision !== input.expectedContextRevision)
              return yield* error(
                "conflict",
                "Project decisions changed since they were read.",
                input.projectId,
              );
            const sourceRows = yield* sql`SELECT 1 FROM project_coordinator_requests
            WHERE project_id = ${input.projectId} AND source_message_id = ${input.sourceMessageId}`;
            if (sourceRows.length === 0)
              return yield* error(
                "invalid_link",
                "Decision source message is not a project request.",
                input.projectId,
              );
            const now = yield* nowIso;
            const decisionVersion = (current?.version ?? 0) + 1;
            yield* sql`INSERT INTO project_coordinator_decisions (
            project_id, decision_id, text, source_message_id, version, created_at, updated_at
          ) VALUES (${input.projectId}, ${input.id}, ${input.text}, ${input.sourceMessageId},
            ${decisionVersion}, ${current?.createdAt ?? now}, ${now})
          ON CONFLICT(project_id, decision_id) DO UPDATE SET
            text = excluded.text, source_message_id = excluded.source_message_id,
            version = excluded.version, updated_at = excluded.updated_at`;
            const updateRows = yield* sql<{
              readonly contextRevision: number;
            }>`UPDATE project_coordinator_projects
            SET context_revision = context_revision + 1, updated_at = ${now}
            WHERE project_id = ${input.projectId} AND context_revision = ${input.expectedContextRevision}
            RETURNING context_revision AS contextRevision`;
            if (updateRows.length === 0)
              return yield* error(
                "conflict",
                "Project decisions changed since they were read.",
                input.projectId,
              );
            return yield* readSnapshot(input.projectId);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Project coordinator decision persistence failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const recordNotification: ProjectCoordinatorStore["Service"]["recordNotification"] = (input) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* nowIso;
            const isOpenQuestion =
              input.kind === "pending_decision" ||
              input.kind === "worker_waiting" ||
              input.kind === "dispatch_blocked";
            yield* sql`INSERT INTO project_coordinator_notifications (
            project_id, notification_id, task_id, worker_thread_id, source_message_id,
            runtime_request_id, kind, summary, status, observed_at, resolved_at,
            resolution_message_id, created_at
          ) VALUES (${input.projectId}, ${input.id}, ${input.taskId}, ${input.workerThreadId},
            ${input.sourceMessageId ?? null}, ${input.runtimeRequestId ?? null}, ${input.kind},
            ${input.summary}, ${isOpenQuestion ? "pending" : "resolved"},
            NULL, ${isOpenQuestion ? null : now}, NULL, ${now})
          ON CONFLICT(project_id, notification_id) DO NOTHING`;
            const rows = yield* sql<NotificationRow>`SELECT notification_id AS id,
            task_id AS taskId, worker_thread_id AS workerThreadId,
            source_message_id AS sourceMessageId, runtime_request_id AS runtimeRequestId,
            kind, summary, status, observed_at AS observedAt, resolved_at AS resolvedAt,
            resolution_message_id AS resolutionMessageId, created_at AS createdAt
            FROM project_coordinator_notifications WHERE project_id = ${input.projectId}
            AND notification_id = ${input.id}`;
            const row = rows[0];
            if (
              row === undefined ||
              row.kind !== input.kind ||
              row.taskId !== input.taskId ||
              row.workerThreadId !== input.workerThreadId ||
              row.sourceMessageId !== (input.sourceMessageId ?? null) ||
              row.runtimeRequestId !== (input.runtimeRequestId ?? null)
            )
              return yield* error(
                "conflict",
                "Coordinator notification ID already exists with different identity.",
                input.projectId,
              );
            return yield* readSnapshot(input.projectId);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator notification persistence failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const observeNotification: ProjectCoordinatorStore["Service"]["observeNotification"] = (
      input,
    ) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* nowIso;
            const rows =
              yield* sql`UPDATE project_coordinator_notifications SET observed_at = COALESCE(observed_at, ${now})
            WHERE project_id = ${input.projectId} AND notification_id = ${input.id}`;
            if (rows.length === 0) {
              const found = yield* sql`SELECT 1 FROM project_coordinator_notifications
              WHERE project_id = ${input.projectId} AND notification_id = ${input.id}`;
              if (found.length === 0)
                return yield* error(
                  "not_found",
                  "Coordinator notification was not found.",
                  input.projectId,
                );
            }
            return yield* readSnapshot(input.projectId);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator notification observation failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const resolveNotification: ProjectCoordinatorStore["Service"]["resolveNotification"] = (
      input,
    ) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const now = yield* nowIso;
            const rows = yield* sql`UPDATE project_coordinator_notifications
            SET status = 'resolved', resolved_at = COALESCE(resolved_at, ${now}),
              resolution_message_id = COALESCE(resolution_message_id, ${input.resolutionMessageId})
            WHERE project_id = ${input.projectId} AND notification_id = ${input.id}`;
            if (rows.length === 0) {
              const found = yield* sql`SELECT 1 FROM project_coordinator_notifications
              WHERE project_id = ${input.projectId} AND notification_id = ${input.id}`;
              if (found.length === 0)
                return yield* error(
                  "not_found",
                  "Coordinator notification was not found.",
                  input.projectId,
                );
            }
            return yield* readSnapshot(input.projectId);
          }),
        )
        .pipe(
          Effect.tap(() => signalChange(input.projectId)),
          Effect.catch((cause) =>
            isCoordinatorError(cause)
              ? Effect.fail(cause)
              : Effect.logError("Coordinator notification resolution failed", {
                  cause,
                  projectId: input.projectId,
                }).pipe(Effect.andThen(Effect.fail(storageError(input.projectId)))),
          ),
        );

    const listPendingDispatches: ProjectCoordinatorStore["Service"]["listPendingDispatches"] = () =>
      Effect.gen(function* () {
        const rows = yield* sql<RequestRow>`SELECT request_id AS id,
          project_id AS projectId, sequence, source_message_id AS sourceMessageId,
          original_user_text AS text, status, route, task_id AS taskId,
          worker_thread_id AS workerThreadId, command_id AS commandId,
          route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
          FROM project_coordinator_requests WHERE status IN ('pending', 'dispatching')
          ORDER BY project_id, sequence`;
        return yield* Effect.forEach(rows, decodeRequestRow);
      }).pipe(
        Effect.catch((cause) =>
          isCoordinatorError(cause)
            ? Effect.fail(cause)
            : Effect.logError("Coordinator pending dispatch read failed", { cause }).pipe(
                Effect.andThen(Effect.fail(storageError())),
              ),
        ),
      );

    const listRequestsForWorker: ProjectCoordinatorStore["Service"]["listRequestsForWorker"] = (
      workerThreadId,
    ) =>
      Effect.gen(function* () {
        const rows = yield* sql<RequestRow>`SELECT request_id AS id,
          project_id AS projectId, sequence, source_message_id AS sourceMessageId,
          original_user_text AS text, status, route, task_id AS taskId,
          worker_thread_id AS workerThreadId, command_id AS commandId,
          route_payload_json AS routePayload, error, created_at AS createdAt, updated_at AS updatedAt
          FROM project_coordinator_requests WHERE worker_thread_id = ${workerThreadId}
          ORDER BY project_id, sequence`;
        return yield* Effect.forEach(rows, decodeRequestRow);
      }).pipe(
        Effect.catch((cause) =>
          isCoordinatorError(cause)
            ? Effect.fail(cause)
            : Effect.logError("Coordinator worker request lookup failed", {
                cause,
                workerThreadId,
              }).pipe(Effect.andThen(Effect.fail(storageError()))),
        ),
      );

    return ProjectCoordinatorStore.of({
      ensureProject,
      read,
      subscribe,
      readForThread,
      recordRequest,
      getRequest,
      reserveRoute,
      markRequest,
      recordDecision,
      recordNotification,
      observeNotification,
      resolveNotification,
      listPendingDispatches,
      listRequestsForWorker,
    });
  }),
);
