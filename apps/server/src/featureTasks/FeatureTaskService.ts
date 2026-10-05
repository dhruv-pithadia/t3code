import {
  FeatureTask,
  FeatureTaskError,
  FeatureTaskId,
  type FeatureTask as FeatureTaskModel,
  FeatureTaskCreateInput,
  type FeatureTaskListInput,
  type FeatureTaskUpdateInput,
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

export class FeatureTaskService extends Context.Service<
  FeatureTaskService,
  {
    readonly list: (
      input: FeatureTaskListInput,
    ) => Effect.Effect<{ readonly tasks: ReadonlyArray<FeatureTaskModel> }, FeatureTaskError>;
    readonly subscribe: (
      input: FeatureTaskListInput,
    ) => Stream.Stream<{ readonly tasks: ReadonlyArray<FeatureTaskModel> }, FeatureTaskError>;
    readonly get: (input: {
      readonly id: FeatureTaskId;
    }) => Effect.Effect<{ readonly task: FeatureTaskModel }, FeatureTaskError>;
    readonly readForThread: (
      threadId: ThreadId,
    ) => Effect.Effect<FeatureTaskModel | null, FeatureTaskError>;
    readonly create: (
      input: FeatureTaskCreateInput,
    ) => Effect.Effect<{ readonly task: FeatureTaskModel }, FeatureTaskError>;
    readonly update: (
      input: FeatureTaskUpdateInput,
    ) => Effect.Effect<{ readonly task: FeatureTaskModel }, FeatureTaskError>;
  }
>()("yantrix/featureTasks/FeatureTaskService") {}

interface FeatureTaskRow {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly objective: string;
  readonly acceptanceCriteria: string;
  readonly decisions: string;
  readonly nextAction: string;
  readonly handoff: string;
  readonly status: string;
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const decodeTask = Schema.decodeUnknownEffect(FeatureTask);
const decodeList = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeList = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));
const encodeCreateInput = Schema.encodeSync(Schema.fromJsonString(FeatureTaskCreateInput));
const isFeatureTaskError = Schema.is(FeatureTaskError);
const nowIso = Effect.map(DateTime.now, (now) => DateTime.formatIso(DateTime.toUtc(now)));
const toError = (code: FeatureTaskError["code"], message: string, taskId?: FeatureTaskId) =>
  new FeatureTaskError({ code, message, ...(taskId === undefined ? {} : { taskId }) });
const storageError = (taskId?: FeatureTaskId) =>
  toError("storage", "Feature task storage failed.", taskId);

const decodeTaskRow = Effect.fn("FeatureTaskService.decodeTaskRow")(function* (
  row: FeatureTaskRow,
  threadIds: ReadonlyArray<string>,
) {
  const id = FeatureTaskId.make(row.id);
  const acceptanceCriteria = yield* decodeList(row.acceptanceCriteria).pipe(
    Effect.mapError(() => storageError(id)),
  );
  const decisions = yield* decodeList(row.decisions).pipe(Effect.mapError(() => storageError(id)));
  return yield* decodeTask({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    objective: row.objective,
    acceptanceCriteria,
    decisions,
    nextAction: row.nextAction,
    handoff: row.handoff,
    status: row.status,
    threadIds,
    archivedAt: row.archivedAt,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }).pipe(Effect.mapError(() => storageError(id)));
});

export const layer = Layer.effect(
  FeatureTaskService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const changes = yield* PubSub.sliding<void>(1);
    const signalChange = PubSub.publish(changes, undefined).pipe(Effect.asVoid);

    const load = Effect.fn("FeatureTaskService.load")(function* (id: FeatureTaskId) {
      return yield* Effect.gen(function* () {
        const rows = yield* sql<FeatureTaskRow>`
          SELECT task_id AS id, project_id AS projectId, title, objective,
            acceptance_criteria_json AS acceptanceCriteria, decisions_json AS decisions,
            next_action AS nextAction, handoff, status, archived_at AS archivedAt,
            version, created_at AS createdAt, updated_at AS updatedAt
          FROM feature_tasks WHERE task_id = ${id}
        `;
        const row = rows[0];
        if (row === undefined) return null;
        const linkedRows = yield* sql<{ readonly threadId: string }>`
          SELECT thread_id AS threadId FROM feature_task_threads
          WHERE task_id = ${id} ORDER BY position ASC
        `;
        return yield* decodeTaskRow(
          row,
          linkedRows.map(({ threadId }) => threadId),
        );
      }).pipe(
        Effect.catch(() =>
          Effect.logError("Feature task read failed", { taskId: id }).pipe(
            Effect.andThen(Effect.fail(storageError(id))),
          ),
        ),
      );
    });

    const listForProject = Effect.fn("FeatureTaskService.list")(function* (projectId?: ProjectId) {
      return yield* Effect.gen(function* () {
        const rows =
          projectId === undefined
            ? yield* sql<FeatureTaskRow>`
              SELECT task_id AS id, project_id AS projectId, title, objective,
                acceptance_criteria_json AS acceptanceCriteria, decisions_json AS decisions,
                next_action AS nextAction, handoff, status, archived_at AS archivedAt,
                version, created_at AS createdAt, updated_at AS updatedAt
              FROM feature_tasks ORDER BY updated_at DESC, task_id
            `
            : yield* sql<FeatureTaskRow>`
              SELECT task_id AS id, project_id AS projectId, title, objective,
                acceptance_criteria_json AS acceptanceCriteria, decisions_json AS decisions,
                next_action AS nextAction, handoff, status, archived_at AS archivedAt,
                version, created_at AS createdAt, updated_at AS updatedAt
              FROM feature_tasks WHERE project_id = ${projectId}
              ORDER BY updated_at DESC, task_id
            `;
        const links = yield* sql<{ readonly taskId: string; readonly threadId: string }>`
          SELECT task_id AS taskId, thread_id AS threadId FROM feature_task_threads
          ORDER BY task_id, position
        `;
        const byTask = new Map<string, Array<string>>();
        for (const link of links)
          byTask.set(link.taskId, [...(byTask.get(link.taskId) ?? []), link.threadId]);
        const tasks = yield* Effect.forEach(rows, (row) =>
          decodeTaskRow(row, byTask.get(row.id) ?? []),
        );
        return { tasks };
      }).pipe(
        Effect.catch(() =>
          Effect.logError("Feature task list failed").pipe(
            Effect.andThen(Effect.fail(storageError())),
          ),
        ),
      );
    });

    const validateProject = (projectId: ProjectId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly projectId: string }>`
          SELECT project_id AS projectId FROM projection_projects
          WHERE project_id = ${projectId} AND deleted_at IS NULL
        `;
        if (rows.length === 0) {
          return yield* toError("invalid_link", "The workspace is unavailable.");
        }
      });

    const validateThreads = (
      projectId: ProjectId,
      threadIds: ReadonlyArray<ThreadId>,
      taskId?: FeatureTaskId,
      retained: ReadonlySet<string> = new Set(),
    ) =>
      Effect.gen(function* () {
        const seen = new Set<string>();
        for (const threadId of threadIds) {
          if (seen.has(threadId))
            return yield* toError("invalid_link", "Conversation links must be unique.", taskId);
          seen.add(threadId);
          const rows = yield* sql<{ readonly projectId: string }>`
            SELECT project_id AS projectId FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}
          `;
          if (rows[0]?.projectId !== projectId && !retained.has(threadId)) {
            return yield* toError(
              "invalid_link",
              "Conversation must exist in the task workspace.",
              taskId,
            );
          }
          const owner = yield* sql<{ readonly taskId: string }>`
            SELECT task_id AS taskId FROM feature_task_threads WHERE thread_id = ${threadId}
          `;
          if (owner[0] !== undefined && owner[0].taskId !== taskId) {
            return yield* toError(
              "conflict",
              "Conversation is already linked to another feature task.",
              taskId,
            );
          }
        }
      });

    const saveLinks = (taskId: FeatureTaskId, threadIds: ReadonlyArray<ThreadId>) =>
      Effect.gen(function* () {
        yield* sql`DELETE FROM feature_task_threads WHERE task_id = ${taskId}`;
        for (const [position, threadId] of threadIds.entries()) {
          yield* sql`INSERT INTO feature_task_threads (thread_id, task_id, position) VALUES (${threadId}, ${taskId}, ${position})`;
        }
      });

    const list: FeatureTaskService["Service"]["list"] = (input) => listForProject(input.projectId);
    const subscribe: FeatureTaskService["Service"]["subscribe"] = (input) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(list(input)),
            Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => list(input))),
          );
        }),
      );

    const get: FeatureTaskService["Service"]["get"] = Effect.fn("FeatureTaskService.get")(
      ({ id }) =>
        load(id).pipe(
          Effect.flatMap((task) =>
            task === null
              ? Effect.fail(toError("not_found", "Feature task was not found.", id))
              : Effect.succeed({ task }),
          ),
        ),
    );

    const readForThread: FeatureTaskService["Service"]["readForThread"] = Effect.fn(
      "FeatureTaskService.readForThread",
    )((threadId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly taskId: string }>`
          SELECT task_id AS taskId FROM feature_task_threads WHERE thread_id = ${threadId}
        `;
        const taskId = rows[0]?.taskId;
        return taskId === undefined ? null : yield* load(FeatureTaskId.make(taskId));
      }).pipe(
        Effect.catch((cause) =>
          Effect.logError("Feature task thread lookup failed", { cause, threadId }).pipe(
            Effect.andThen(Effect.fail(storageError())),
          ),
        ),
      ),
    );

    const create: FeatureTaskService["Service"]["create"] = Effect.fn("FeatureTaskService.create")(
      (input) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const existing = yield* load(input.id);
              if (existing !== null) {
                const rows = yield* sql<{ readonly createPayload: string }>`
            SELECT create_payload_json AS createPayload FROM feature_tasks WHERE task_id = ${input.id}
          `;
                if (rows[0]?.createPayload === encodeCreateInput(input)) return { task: existing };
                return yield* toError(
                  "conflict",
                  "Feature task ID already exists with different content.",
                  input.id,
                );
              }
              yield* validateProject(input.projectId);
              yield* validateThreads(input.projectId, input.threadIds, input.id);
              const now = yield* nowIso;
              yield* sql`
          INSERT INTO feature_tasks (
            task_id, create_payload_json, project_id, title, objective, acceptance_criteria_json, decisions_json,
            next_action, handoff, status, archived_at, version, created_at, updated_at
          ) VALUES (
            ${input.id}, ${encodeCreateInput(input)}, ${input.projectId}, ${input.title}, ${input.objective},
            ${encodeList(input.acceptanceCriteria)}, ${encodeList(input.decisions)},
            ${input.nextAction}, ${input.handoff}, 'requested', NULL, 1, ${now}, ${now}
          )
        `;
              yield* saveLinks(input.id, input.threadIds);
              return { task: yield* load(input.id).pipe(Effect.map((task) => task!)) };
            }),
          )
          .pipe(
            Effect.tap(() => signalChange),
            Effect.catch((cause) =>
              isFeatureTaskError(cause)
                ? Effect.fail(cause)
                : Effect.logError("Feature task create failed", { cause, taskId: input.id }).pipe(
                    Effect.andThen(Effect.fail(storageError(input.id))),
                  ),
            ),
          ),
    );

    const update: FeatureTaskService["Service"]["update"] = Effect.fn("FeatureTaskService.update")(
      (input) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              const current = yield* load(input.id);
              if (current === null)
                return yield* toError("not_found", "Feature task was not found.", input.id);
              if (current.version !== input.expectedVersion) {
                return yield* toError(
                  "conflict",
                  "Feature task changed since it was read.",
                  input.id,
                );
              }
              const patch = input.patch;
              const threadIds = patch.threadIds ?? current.threadIds;
              if (patch.threadIds !== undefined)
                yield* validateThreads(
                  current.projectId,
                  threadIds,
                  input.id,
                  new Set(current.threadIds),
                );
              const now = yield* nowIso;
              const archivedAt =
                patch.archived === undefined ? current.archivedAt : patch.archived ? now : null;
              const next = {
                title: patch.title ?? current.title,
                objective: patch.objective ?? current.objective,
                acceptanceCriteria: patch.acceptanceCriteria ?? current.acceptanceCriteria,
                decisions: patch.decisions ?? current.decisions,
                nextAction: patch.nextAction ?? current.nextAction,
                handoff: patch.handoff ?? current.handoff,
                status: patch.status ?? current.status,
              };
              const updated = yield* sql<FeatureTaskRow>`
          UPDATE feature_tasks SET title = ${next.title}, objective = ${next.objective},
            acceptance_criteria_json = ${encodeList(next.acceptanceCriteria)},
            decisions_json = ${encodeList(next.decisions)}, next_action = ${next.nextAction},
            handoff = ${next.handoff}, status = ${next.status}, archived_at = ${archivedAt},
            version = version + 1, updated_at = ${now}
          WHERE task_id = ${input.id} AND version = ${input.expectedVersion}
          RETURNING task_id AS id
        `;
              if (updated.length === 0)
                return yield* toError(
                  "conflict",
                  "Feature task changed since it was read.",
                  input.id,
                );
              if (patch.threadIds !== undefined) yield* saveLinks(input.id, threadIds);
              return { task: yield* load(input.id).pipe(Effect.map((task) => task!)) };
            }),
          )
          .pipe(
            Effect.tap(() => signalChange),
            Effect.catch((cause) =>
              isFeatureTaskError(cause)
                ? Effect.fail(cause)
                : Effect.logError("Feature task update failed", { cause, taskId: input.id }).pipe(
                    Effect.andThen(Effect.fail(storageError(input.id))),
                  ),
            ),
          ),
    );

    return FeatureTaskService.of({ list, subscribe, get, readForThread, create, update });
  }),
);
