import * as NodeUtil from "node:util";
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  FeatureTaskId,
  MessageId,
  ProjectCoordinatorError,
  ProjectCoordinatorStartupPacket,
  ThreadId,
  type ModelSelection,
  type ProjectCoordinatorDecisionInput,
  type ProjectCoordinatorEvidenceInput,
  type ProjectCoordinatorEvidenceResult,
  type ProjectCoordinatorObserveNotificationInput,
  type ProjectCoordinatorOpenInput,
  type ProjectCoordinatorQuestionInput,
  type ProjectCoordinatorResolveNotificationInput,
  type ProjectCoordinatorReadInput,
  type ProjectCoordinatorRequest,
  type ProjectCoordinatorRouteInput,
  type ProjectCoordinatorSendInput,
  type ProjectCoordinatorSnapshot,
} from "@yantrix/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as FeatureTasks from "../featureTasks/FeatureTaskService.ts";
import * as FeatureTaskWorkspaces from "../featureTasks/FeatureTaskWorkspaceService.ts";
import { makeKeyedSerialExecutor } from "../orchestration-v2/KeyedSerialExecutor.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/Services/ProviderRegistry.ts";
import * as ProjectService from "./ProjectService.ts";
import * as CoordinatorStore from "./ProjectCoordinatorStore.ts";

type CoordinatorAction =
  | { readonly kind: "read"; readonly input: ProjectCoordinatorEvidenceInput }
  | { readonly kind: "route"; readonly input: ProjectCoordinatorRouteInput }
  | { readonly kind: "decision"; readonly input: ProjectCoordinatorDecisionInput }
  | { readonly kind: "ask"; readonly input: ProjectCoordinatorQuestionInput }
  | { readonly kind: "resolve"; readonly input: ProjectCoordinatorResolveNotificationInput }
  | { readonly kind: "observe"; readonly input: ProjectCoordinatorObserveNotificationInput };

export class ProjectCoordinatorService extends Context.Service<
  ProjectCoordinatorService,
  {
    readonly invoke: (input: {
      readonly callerThreadId: ThreadId;
      readonly action: CoordinatorAction;
    }) => Effect.Effect<ProjectCoordinatorEvidenceResult, ProjectCoordinatorError>;
    readonly open: (
      input: ProjectCoordinatorOpenInput,
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly read: (
      input: ProjectCoordinatorReadInput,
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly subscribe: (
      input: ProjectCoordinatorReadInput,
    ) => Stream.Stream<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly send: (
      input: ProjectCoordinatorSendInput,
    ) => Effect.Effect<{ readonly snapshot: ProjectCoordinatorSnapshot }, ProjectCoordinatorError>;
    readonly route: (input: {
      readonly callerThreadId: ThreadId;
      readonly route: ProjectCoordinatorRouteInput;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly recordDecision: (input: {
      readonly callerThreadId: ThreadId;
      readonly decision: ProjectCoordinatorDecisionInput;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly ask: (input: {
      readonly callerThreadId: ThreadId;
      readonly question: ProjectCoordinatorQuestionInput;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly resolveQuestion: (input: {
      readonly callerThreadId: ThreadId;
      readonly resolution: ProjectCoordinatorResolveNotificationInput;
    }) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    readonly observeNotification: (
      input: ProjectCoordinatorObserveNotificationInput,
    ) => Effect.Effect<ProjectCoordinatorSnapshot, ProjectCoordinatorError>;
    /** Replay only persisted command identities after ordinary provider recovery has completed. */
    readonly reconcile: Effect.Effect<void, ProjectCoordinatorError>;
  }
>()("yantrix/project/ProjectCoordinatorService") {}

const identity = (kind: string, ...parts: ReadonlyArray<string>) =>
  `coordinator:${kind}:${NodeCrypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32)}`;

const isCoordinatorError = Schema.is(ProjectCoordinatorError);
const encodeStartupPacket = Schema.encodeSync(
  Schema.fromJsonString(ProjectCoordinatorStartupPacket),
);
const encodeDirection = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String, version: Schema.Number })),
  ),
);

const invalid = (message: string) => new ProjectCoordinatorError({ code: "invalid_link", message });
const conflict = (message: string) => new ProjectCoordinatorError({ code: "conflict", message });
const failure = (operation: string) => (_cause: unknown) =>
  new ProjectCoordinatorError({
    code: "storage",
    message: `Coordinator ${operation} failed. Retry the same request to reconcile its saved dispatch.`,
  });

const make = Effect.gen(function* () {
  const store = yield* CoordinatorStore.ProjectCoordinatorStore;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const tasks = yield* FeatureTasks.FeatureTaskService;
  const workspaces = yield* FeatureTaskWorkspaces.FeatureTaskWorkspaceService;
  const sql = yield* SqlClient.SqlClient;
  const events = yield* EventStore.EventStoreV2;
  const locks = yield* makeKeyedSerialExecutor<string>();

  const validateProject = Effect.fn("ProjectCoordinator.validateProject")(function* (
    projectId: ProjectCoordinatorReadInput["projectId"],
  ) {
    const project = yield* projects
      .getById(projectId)
      .pipe(Effect.mapError(failure("project lookup")));
    if (Option.isNone(project)) return yield* invalid("The coordinator project is unavailable.");
  });

  const validateModel = Effect.fn("ProjectCoordinator.validateModel")(function* (
    selection: ModelSelection,
  ) {
    const available = yield* providers.getProviders;
    const provider = available.find(({ instanceId }) => instanceId === selection.instanceId);
    if (provider?.driver !== "codex")
      return yield* invalid(
        "The native coordinator currently requires a configured Codex provider.",
      );
    if (!provider.models.some(({ slug }) => slug === selection.model))
      return yield* invalid("Select an available model from the configured Codex provider.");
  });

  const read = Effect.fn("ProjectCoordinator.read")(function* (input: ProjectCoordinatorReadInput) {
    yield* validateProject(input.projectId);
    return yield* store.read(input);
  });

  const open = Effect.fn("ProjectCoordinator.open")(function* (input: ProjectCoordinatorOpenInput) {
    return yield* locks.withLock(
      input.projectId,
      Effect.gen(function* () {
        yield* validateProject(input.projectId);
        const current = yield* store.read({ projectId: input.projectId });
        const selection = current.modelSelection ?? input.modelSelection;
        yield* validateModel(selection);
        const threadId = current.threadId ?? ThreadId.make(identity("thread", input.projectId));
        const state = yield* store.ensureProject({
          projectId: input.projectId,
          threadId,
          modelSelection: selection,
        });
        if (state.threadId === null || state.modelSelection === null)
          return yield* invalid("The coordinator thread binding is unavailable.");
        const shell = yield* threads
          .getThreadShell(state.threadId)
          .pipe(Effect.mapError(failure("thread lookup")));
        if (shell !== null) {
          if (
            shell.projectId !== input.projectId ||
            shell.deletedAt !== null ||
            shell.archivedAt !== null
          )
            return yield* conflict(
              "Restore the existing coordinator conversation before opening it.",
            );
          return state;
        }
        yield* launches
          .launch({
            commandId: CommandId.make(identity("open", input.projectId)),
            threadId: state.threadId,
            projectId: input.projectId,
            title: "Project coordinator",
            modelSelection: state.modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            workspaceStrategy: { type: "root" },
            createdBy: "user",
            creationSource: "web",
          })
          .pipe(Effect.mapError(failure("open")));
        return yield* store.read({ projectId: input.projectId });
      }),
    );
  });

  const deliverInbox = Effect.fn("ProjectCoordinator.deliverInbox")(function* (
    request: ProjectCoordinatorRequest,
  ) {
    const snapshot = yield* store.read({ projectId: request.projectId });
    if (snapshot.threadId === null || snapshot.modelSelection === null)
      return yield* invalid("Open the project coordinator before sending a request.");
    const delivered = yield* threads
      .sendToThread({
        projectId: request.projectId,
        threadId: snapshot.threadId,
        commandId: CommandId.make(identity("inbox", request.projectId, request.id)),
        messageId: request.sourceMessageId,
        text: request.text,
        attachments: [],
        modelSelection: snapshot.modelSelection,
        mode: "queue",
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(failure("inbox delivery")));
    if (
      delivered.run.queueHeld === true ||
      ["cancelled", "failed", "interrupted"].includes(delivered.run.status)
    ) {
      const detail =
        "This coordinator request is saved, but its previous turn was stopped or held after restart. Open the coordinator conversation and use its resume control, or send a new message to continue.";
      yield* store.markRequest({
        projectId: request.projectId,
        sourceMessageId: request.sourceMessageId,
        status: "pending",
        error: detail,
      });
      yield* store.recordNotification({
        projectId: request.projectId,
        id: identity("inbox-held", request.projectId, request.id),
        taskId: null,
        workerThreadId: null,
        sourceMessageId: request.sourceMessageId,
        kind: "dispatch_blocked",
        summary: detail,
      });
    }
  });

  const send = Effect.fn("ProjectCoordinator.send")(function* (input: ProjectCoordinatorSendInput) {
    return yield* locks.withLock(
      input.projectId,
      Effect.gen(function* () {
        if (input.text.trim() === "")
          return yield* invalid("Enter a message for the project coordinator.");
        yield* validateProject(input.projectId);
        const state = yield* store.read({ projectId: input.projectId });
        if (state.threadId === null)
          return yield* invalid("Open the project coordinator before sending a request.");
        const request = yield* store.recordRequest({
          projectId: input.projectId,
          id: input.requestId,
          sourceMessageId: MessageId.make(identity("message", input.projectId, input.requestId)),
          text: input.text,
        });
        // The same command/message identity replays a receipt, including after an ambiguous provider acceptance.
        if (request.status === "pending") yield* deliverInbox(request);
        return { snapshot: yield* store.read({ projectId: input.projectId }) };
      }),
    );
  });

  const callerState = Effect.fn("ProjectCoordinator.callerState")(function* (threadId: ThreadId) {
    const context = yield* store.readForThread(threadId);
    if (context === null || !context.isCoordinator)
      return yield* invalid(
        "Only the project's coordinator conversation can route work or change product decisions.",
      );
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(failure("caller lookup")));
    if (shell === null || shell.archivedAt !== null || shell.deletedAt !== null)
      return yield* invalid("The coordinator conversation is unavailable.");
    return context.snapshot;
  });

  const blocked = Effect.fn("ProjectCoordinator.blocked")(function* (
    request: ProjectCoordinatorRequest,
    message: string,
  ) {
    yield* store.markRequest({
      projectId: request.projectId,
      sourceMessageId: request.sourceMessageId,
      status: "blocked",
      error: message,
    });
    yield* store.recordNotification({
      projectId: request.projectId,
      id: identity("blocked", request.projectId, request.id),
      taskId: request.taskId,
      workerThreadId: request.workerThreadId,
      kind: "dispatch_blocked",
      summary: message.slice(0, 4_000),
    });
  });

  const executeIntent = Effect.fn("ProjectCoordinator.executeIntent")(function* (
    request: ProjectCoordinatorRequest,
  ) {
    if (request.status !== "dispatching") return;
    const state = yield* store.read({ projectId: request.projectId });
    if (
      request.taskId === null ||
      request.workerThreadId === null ||
      request.commandId === null ||
      request.routePayload === null ||
      state.modelSelection === null ||
      state.threadId === null
    )
      return yield* invalid("The persisted dispatch intent is incomplete.");
    const { task } = yield* tasks
      .get({ id: request.taskId })
      .pipe(Effect.mapError(failure("task lookup")));
    if (task.projectId !== request.projectId || task.archivedAt !== null)
      return yield* invalid("The routed feature is unavailable in this project.");
    if (request.route === "follow_up") {
      const shell = yield* threads
        .getThreadShell(request.workerThreadId)
        .pipe(Effect.mapError(failure("worker lookup")));
      if (
        shell === null ||
        shell.projectId !== request.projectId ||
        shell.deletedAt !== null ||
        shell.archivedAt !== null
      )
        return yield* invalid("Restore the existing feature worker before continuing it.");
      yield* workspaces
        .assertThreadWorkspace({
          taskId: task.id,
          threadId: shell.id,
          worktreePath: shell.worktreePath,
          branch: shell.branch,
        })
        .pipe(Effect.mapError(failure("workspace validation")));
      const acceptedFollowup = yield* threads
        .sendToThread({
          projectId: request.projectId,
          threadId: request.workerThreadId,
          commandId: request.commandId,
          messageId: MessageId.make(identity("worker-message", request.projectId, request.id)),
          senderThreadId: state.threadId,
          text: request.text,
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(failure("follow-up delivery")));
      if (
        acceptedFollowup.run.queueHeld === true ||
        ["cancelled", "failed", "interrupted"].includes(acceptedFollowup.run.status)
      ) {
        yield* blocked(
          request,
          "The follow-up remains attached to its existing feature, but the accepted worker turn was stopped or held. Resume that conversation explicitly.",
        );
        return;
      }
    } else {
      const workspace = yield* workspaces
        .ensure({ id: task.id })
        .pipe(Effect.mapError(failure("workspace preparation")));
      if (workspace.state !== "ready" || workspace.binding === null) {
        yield* blocked(
          request,
          `Feature dispatch is blocked because its workspace is ${workspace.state.replaceAll("_", " ")}.`,
        );
        return;
      }
      const binding = workspace.binding;
      const launchInput = {
        commandId: request.commandId,
        threadId: request.workerThreadId,
        projectId: request.projectId,
        title: request.routePayload.route.title ?? task.title,
        modelSelection: state.modelSelection,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        workspaceStrategy: {
          type: "existing_worktree" as const,
          worktreePath: binding.worktreePath,
          branch: binding.branch,
        },
        createdBy: "agent" as const,
        creationSource: "mcp" as const,
      };
      const shell = yield* threads
        .getThreadShell(request.workerThreadId)
        .pipe(Effect.mapError(failure("worker lookup")));
      if (
        shell !== null &&
        (shell.projectId !== request.projectId ||
          shell.worktreePath !== binding.worktreePath ||
          shell.branch !== binding.branch ||
          shell.deletedAt !== null ||
          shell.archivedAt !== null)
      )
        return yield* conflict(
          "The existing worker no longer matches its persisted feature workspace.",
        );
      // Link the durable worker before any initial turn can pass the task workspace guard.
      yield* threads
        .dispatch({
          type: "thread.create",
          commandId: request.commandId,
          threadId: request.workerThreadId,
          projectId: request.projectId,
          title: request.routePayload.route.title ?? task.title,
          modelSelection: state.modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: binding.branch,
          worktreePath: binding.worktreePath,
          createdBy: "agent",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(failure("worker creation")));
      const { task: currentTask } = yield* tasks
        .get({ id: task.id })
        .pipe(Effect.mapError(failure("task lookup")));
      if (!currentTask.threadIds.includes(request.workerThreadId))
        yield* tasks
          .update({
            id: task.id,
            expectedVersion: currentTask.version,
            patch: {
              threadIds: [...currentTask.threadIds, request.workerThreadId],
              status: "building",
            },
          })
          .pipe(Effect.mapError(failure("worker link")));
      const packet = request.routePayload.startupPacket;
      const proposedPlan = request.routePayload.route.objective;
      const workerText = [
        "Implement this authorized feature in its bound task workspace. Its objective preserves original user intent; task acceptanceCriteria, decisions, nextAction and handoff are coordinator planning proposals unless supported by a user source. Keep proposed planning notes separate from accepted product decisions. Validate the result and report evidence. The user decides whether to merge.",
        `Original user request:\n${request.text}`,
        ...(proposedPlan ? [`Coordinator planning proposal:\n${proposedPlan}`] : []),
        ...(packet
          ? [
              `Dispatch startup packet (accepted direction, not implementation evidence):\n${encodeStartupPacket(packet)}`,
            ]
          : []),
      ].join("\n\n");
      // launch replays thread.create's receipt and persists a prepared run before starting setup/provider effects.
      const accepted = yield* launches
        .launch({
          ...launchInput,
          initialMessage: {
            messageId: MessageId.make(identity("worker-message", request.projectId, request.id)),
            senderThreadId: state.threadId,
            text: workerText,
            attachments: [],
          },
        })
        .pipe(Effect.mapError(failure("worker launch")));
      const dispatchedRun = accepted.projection.runs.find(
        (run) =>
          run.userMessageId ===
          MessageId.make(identity("worker-message", request.projectId, request.id)),
      );
      if (
        dispatchedRun !== undefined &&
        (dispatchedRun.queueHeld === true ||
          ["cancelled", "failed", "interrupted"].includes(dispatchedRun.status))
      ) {
        yield* blocked(
          request,
          "This feature's existing worker turn was stopped or held after restart. Its task, workspace and original request are preserved. Resume or retry that worker conversation explicitly; no duplicate worker was started.",
        );
        return;
      }
    }
    yield* store.markRequest({
      projectId: request.projectId,
      sourceMessageId: request.sourceMessageId,
      status: "dispatched",
      error: null,
    });
    const acceptedState = yield* store.read({ projectId: request.projectId });
    const blockerId = identity("blocked", request.projectId, request.id);
    if (
      acceptedState.notifications.some((item) => item.id === blockerId && item.status === "pending")
    )
      yield* store.resolveNotification({
        projectId: request.projectId,
        id: blockerId,
        resolutionMessageId: request.sourceMessageId,
      });
    yield* Effect.logInfo("project-coordinator.dispatch-accepted", {
      projectId: request.projectId,
      requestId: request.id,
      taskId: request.taskId,
      workerThreadId: request.workerThreadId,
      route: request.route,
    });
  });

  const route = Effect.fn("ProjectCoordinator.route")(function* (input: {
    readonly callerThreadId: ThreadId;
    readonly route: ProjectCoordinatorRouteInput;
  }) {
    const initial = yield* callerState(input.callerThreadId);
    return yield* locks.withLock(
      initial.projectId,
      Effect.gen(function* () {
        const snapshot = yield* callerState(input.callerThreadId);
        const request = yield* store.getRequest({
          projectId: snapshot.projectId,
          sourceMessageId: input.route.sourceMessageId,
        });
        if (request === null)
          return yield* invalid("Route a durable inbox message from this coordinator project.");
        if (request.status !== "pending") {
          if (
            request.routePayload === null ||
            !NodeUtil.isDeepStrictEqual(request.routePayload.route, input.route)
          )
            return yield* conflict("This request already has a different persisted route.");
          if (request.status === "blocked" && request.route !== "discussion") {
            const resumed = yield* store.markRequest({
              projectId: request.projectId,
              sourceMessageId: request.sourceMessageId,
              status: "dispatching",
              error: null,
            });
            yield* executeIntent(resumed);
          } else if (request.status === "dispatching") yield* executeIntent(request);
          return yield* store.read({ projectId: snapshot.projectId });
        }
        const proposal = input.route;
        let taskId: FeatureTaskId | null = null;
        let workerThreadId: ThreadId | null = null;
        const commandId =
          proposal.kind === "discussion"
            ? null
            : CommandId.make(identity("dispatch", snapshot.projectId, request.id));
        if (proposal.kind === "new_task") {
          if ((proposal.title?.length ?? 0) > 240)
            return yield* invalid("Keep the implementation task title within 240 characters.");
          if (!proposal.title?.trim())
            return yield* invalid("Give the implementation task a concise title.");
          const { tasks: existing } = yield* tasks
            .list({ projectId: snapshot.projectId })
            .pipe(Effect.mapError(failure("task list")));
          if (
            existing.some(
              (task) =>
                task.archivedAt === null &&
                ["requested", "planning", "building", "verifying"].includes(task.status),
            )
          )
            return yield* conflict(
              "A feature is already active. Route its follow-up to that task or pause it before starting another feature.",
            );
          taskId = FeatureTaskId.make(identity("task", snapshot.projectId, request.id));
          workerThreadId = ThreadId.make(identity("worker", snapshot.projectId, request.id));
        } else if (proposal.kind === "follow_up") {
          if (proposal.taskId === undefined)
            return yield* invalid("A feature follow-up requires its existing task id.");
          const { task } = yield* tasks
            .get({ id: proposal.taskId })
            .pipe(Effect.mapError(failure("task lookup")));
          if (task.projectId !== snapshot.projectId || task.archivedAt !== null)
            return yield* invalid("The follow-up feature is unavailable in this project.");
          const { tasks: activeFeatures } = yield* tasks
            .list({ projectId: snapshot.projectId })
            .pipe(Effect.mapError(failure("task list")));
          if (
            activeFeatures.some(
              (other) =>
                other.id !== task.id &&
                other.archivedAt === null &&
                ["requested", "planning", "building", "verifying"].includes(other.status),
            )
          )
            return yield* conflict(
              "Another feature is active. Pause it before resuming this feature's implementation.",
            );
          const previous = snapshot.requests
            .toReversed()
            .find((item) => item.taskId === task.id && item.workerThreadId !== null);
          workerThreadId = previous?.workerThreadId ?? task.threadIds[0] ?? null;
          if (workerThreadId === null)
            return yield* invalid("This feature has no existing worker conversation.");
          taskId = task.id;
        }
        const startupPacket = {
          contextRevision: snapshot.contextRevision,
          decisions: snapshot.decisions.map(({ id, text }) => ({ id, text })),
        };
        if (encodeStartupPacket(startupPacket).length > 12_000)
          return yield* invalid(
            "Accepted project direction exceeds the dispatch startup budget. Consolidate decisions before starting a worker.",
          );
        const reserved = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              if (proposal.kind === "new_task" && taskId !== null) {
                const { tasks: currentFeatures } = yield* tasks
                  .list({ projectId: snapshot.projectId })
                  .pipe(Effect.mapError(failure("task list")));
                if (
                  currentFeatures.some(
                    (task) =>
                      task.id !== taskId &&
                      task.archivedAt === null &&
                      ["requested", "planning", "building", "verifying"].includes(task.status),
                  )
                )
                  return yield* conflict(
                    "A feature became active before this dispatch was committed. Follow up with that feature or pause it first.",
                  );
                yield* tasks
                  .create({
                    id: taskId,
                    projectId: snapshot.projectId,
                    title: proposal.title!,
                    objective: request.text,
                    acceptanceCriteria: proposal.acceptanceCriteria ?? [],
                    decisions: proposal.decisions ?? [],
                    nextAction: proposal.nextAction ?? "Implement and validate the user request.",
                    handoff: proposal.handoff ?? "",
                    threadIds: [],
                  })
                  .pipe(Effect.mapError(failure("task creation")));
              }
              return yield* store.reserveRoute({
                projectId: snapshot.projectId,
                sourceMessageId: request.sourceMessageId,
                route: proposal.kind,
                taskId,
                workerThreadId,
                commandId,
                routePayload: {
                  route: proposal,
                  startupPacket,
                },
              });
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              isCoordinatorError(cause) ? cause : failure("intent transaction")(cause),
            ),
          );
        if (proposal.kind !== "discussion") {
          yield* executeIntent(reserved).pipe(
            Effect.catch((error) =>
              error.code !== "storage"
                ? blocked(reserved, error.message)
                : store
                    .markRequest({
                      projectId: reserved.projectId,
                      sourceMessageId: reserved.sourceMessageId,
                      status: "dispatching",
                      error: error.message,
                    })
                    .pipe(Effect.andThen(Effect.fail(error))),
            ),
          );
        }
        return yield* store.read({ projectId: snapshot.projectId });
      }),
    );
  });

  const recordDecision = Effect.fn("ProjectCoordinator.recordDecision")(function* (input: {
    readonly callerThreadId: ThreadId;
    readonly decision: ProjectCoordinatorDecisionInput;
  }) {
    const snapshot = yield* callerState(input.callerThreadId);
    if (input.decision.projectId !== snapshot.projectId || input.decision.sourceMessageId === null)
      return yield* invalid(
        "A product decision requires a source message from this project inbox.",
      );
    const source = yield* store.getRequest({
      projectId: snapshot.projectId,
      sourceMessageId: input.decision.sourceMessageId,
    });
    if (source === null)
      return yield* invalid("The product decision's source message was not found.");
    const proposedDirection = snapshot.decisions
      .filter(({ id }) => id !== input.decision.id)
      .map(({ id, text, version }) => ({ id, text, version }));
    proposedDirection.push({
      id: input.decision.id,
      text: input.decision.text,
      version: (snapshot.decisions.find(({ id }) => id === input.decision.id)?.version ?? 0) + 1,
    });
    if (encodeDirection(proposedDirection).length > 12_000)
      return yield* invalid(
        "Accepted project direction exceeds the startup context budget. Consolidate an existing decision before adding more.",
      );
    yield* store.recordDecision(input.decision);
    return yield* store.read({ projectId: snapshot.projectId });
  });

  const ask = Effect.fn("ProjectCoordinator.ask")(function* (input: {
    readonly callerThreadId: ThreadId;
    readonly question: ProjectCoordinatorQuestionInput;
  }) {
    const state = yield* callerState(input.callerThreadId);
    if (state.projectId !== input.question.projectId)
      return yield* invalid("Preserve questions only in the calling project.");
    const source = yield* store.getRequest({
      projectId: state.projectId,
      sourceMessageId: input.question.sourceMessageId,
    });
    if (source === null)
      return yield* invalid("A pending product question requires a user inbox source.");
    return yield* store.recordNotification({
      projectId: state.projectId,
      id: input.question.id,
      taskId: source.taskId,
      workerThreadId: source.workerThreadId,
      sourceMessageId: source.sourceMessageId,
      kind: "pending_decision",
      summary: input.question.summary,
    });
  });

  const resolveQuestion = Effect.fn("ProjectCoordinator.resolveQuestion")(function* (input: {
    readonly callerThreadId: ThreadId;
    readonly resolution: ProjectCoordinatorResolveNotificationInput;
  }) {
    const state = yield* callerState(input.callerThreadId);
    if (state.projectId !== input.resolution.projectId)
      return yield* invalid("Resolve questions only in the calling project.");
    const question = state.notifications.find(({ id }) => id === input.resolution.id);
    if (
      question === undefined ||
      question.kind !== "pending_decision" ||
      question.sourceMessageId === null
    )
      return yield* invalid("Resolve a pending product decision using the user's answer.");
    const source = yield* store.getRequest({
      projectId: state.projectId,
      sourceMessageId: question.sourceMessageId,
    });
    const answer = yield* store.getRequest({
      projectId: state.projectId,
      sourceMessageId: input.resolution.resolutionMessageId,
    });
    if (source === null || answer === null || answer.sequence <= source.sequence)
      return yield* invalid(
        "The decision requires a later user inbox answer, not the original request or an assistant plan.",
      );
    return yield* store.resolveNotification(input.resolution);
  });

  const deliverNotification = Effect.fn("ProjectCoordinator.deliverNotification")(
    function* (input: {
      readonly projectId: ProjectCoordinatorReadInput["projectId"];
      readonly id: string;
      readonly summary: string;
    }) {
      const state = yield* store.read({ projectId: input.projectId });
      if (state.threadId === null) return;
      yield* threads
        .sendToThread({
          projectId: input.projectId,
          threadId: state.threadId,
          commandId: CommandId.make(identity("notification", input.projectId, input.id)),
          messageId: MessageId.make(identity("notification-message", input.projectId, input.id)),
          text: `Persisted worker notification ${input.id}: ${input.summary} Read coordinator state and inspect worker evidence as needed. Preserve unresolved product questions; this system notification is not a new user implementation request.`,
          attachments: [],
          mode: "queue",
          createdBy: "agent",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(failure("notification delivery")));
    },
  );

  const superviseThread = Effect.fn("ProjectCoordinator.superviseThread")(function* (
    threadId: ThreadId,
  ) {
    const context = yield* store.readForThread(threadId);
    if (context === null || context.isCoordinator) return;
    const owner = yield* tasks
      .readForThread(threadId)
      .pipe(Effect.mapError(failure("worker task ownership")));
    if (owner === null) return;
    const relevant = (yield* store.listRequestsForWorker(threadId)).filter(
      (request) => request.taskId === owner.id,
    );
    if (relevant.length === 0) return;
    const projection = yield* threads
      .getThreadRecords(threadId, ["runs", "nodes", "runtimeRequests"])
      .pipe(Effect.mapError(failure("worker result")));
    const requestForRun = (run: (typeof projection.runs)[number]) => {
      const seen = new Set<string>();
      let current: (typeof projection.runs)[number] | undefined = run;
      while (current !== undefined && !seen.has(current.id)) {
        seen.add(current.id);
        const messageId = current.userMessageId;
        const matched = relevant.find(
          (item) =>
            MessageId.make(identity("worker-message", item.projectId, item.id)) === messageId,
        );
        if (matched !== undefined) return matched;
        current =
          current.restartContinuationOfRunId === undefined
            ? undefined
            : projection.runs.find(({ id }) => id === current?.restartContinuationOfRunId);
      }
      // A user may continue directly in the worker conversation. Attribute later
      // turns to the already-owned feature without inventing another inbox request.
      const requestedAt = DateTime.formatIso(run.requestedAt);
      return relevant.toReversed().find((item) => item.createdAt <= requestedAt);
    };
    for (const run of projection.runs) {
      if (!["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(run.status))
        continue;
      const request = requestForRun(run);
      if (request === undefined) continue;
      const id = identity("result", request.projectId, run.id, run.status);
      const summary = `Worker turn ${run.status}. Open the worker conversation to inspect its evidence; this does not certify feature completion.`;
      yield* store.recordNotification({
        projectId: request.projectId,
        id,
        taskId: request.taskId,
        workerThreadId: threadId,
        sourceMessageId: request.sourceMessageId,
        kind: run.status === "completed" ? "worker_completed" : "worker_failed",
        summary,
      });
      yield* deliverNotification({ projectId: request.projectId, id, summary });
      if (run.status === "completed" && run.restartContinuationOfRunId !== undefined) {
        const current = yield* store.getRequest({
          projectId: request.projectId,
          sourceMessageId: request.sourceMessageId,
        });
        if (current?.status === "blocked") {
          yield* store.markRequest({
            projectId: request.projectId,
            sourceMessageId: request.sourceMessageId,
            status: "dispatching",
            error: null,
          });
          yield* store.markRequest({
            projectId: request.projectId,
            sourceMessageId: request.sourceMessageId,
            status: "dispatched",
            error: null,
          });
        }
        const blockerId = identity("blocked", request.projectId, request.id);
        const currentState = yield* store.read({ projectId: request.projectId });
        if (
          currentState.notifications.some(
            (item) => item.id === blockerId && item.status === "pending",
          )
        )
          yield* store.resolveNotification({
            projectId: request.projectId,
            id: blockerId,
            resolutionMessageId: request.sourceMessageId,
          });
      }
      const resumed = projection.runs.some(
        (candidate) =>
          candidate.restartContinuationOfRunId === run.id &&
          ["preparing", "starting", "running", "waiting", "completed"].includes(candidate.status),
      );
      if (
        !resumed &&
        (run.queueHeld === true || ["cancelled", "failed", "interrupted"].includes(run.status))
      ) {
        const current = yield* store.getRequest({
          projectId: request.projectId,
          sourceMessageId: request.sourceMessageId,
        });
        if (current?.status === "dispatching" || current?.status === "dispatched")
          yield* store.markRequest({
            projectId: request.projectId,
            sourceMessageId: request.sourceMessageId,
            status: "blocked",
            error: `The existing worker turn ${run.status}; inspect or resume its conversation. Its feature workspace and original intent are retained.`,
          });
      }
    }
    for (const runtimeRequest of projection.runtimeRequests) {
      const node = projection.nodes.find(({ id }) => id === runtimeRequest.nodeId);
      const run = projection.runs.find(({ id }) => id === node?.runId);
      const request = run === undefined ? undefined : requestForRun(run);
      if (request === undefined) continue;
      const id = identity("waiting", request.projectId, runtimeRequest.id);
      if (runtimeRequest.status === "pending") {
        const summary = `The feature worker needs ${runtimeRequest.kind === "user_input" ? "an answer" : "a provider approval or response"}. Open its conversation to respond. This blocker remains pending until its runtime request resolves.`;
        yield* store.recordNotification({
          projectId: request.projectId,
          id,
          taskId: request.taskId,
          workerThreadId: threadId,
          sourceMessageId: request.sourceMessageId,
          runtimeRequestId: runtimeRequest.id,
          kind: "worker_waiting",
          summary,
        });
        yield* deliverNotification({ projectId: request.projectId, id, summary });
      } else {
        const snapshot = yield* store.read({ projectId: request.projectId });
        if (snapshot.notifications.some((item) => item.id === id && item.status === "pending"))
          yield* store.resolveNotification({
            projectId: request.projectId,
            id,
            resolutionMessageId: request.sourceMessageId,
          });
      }
    }
  });

  const reconcile = Effect.gen(function* () {
    const pending = yield* store.listPendingDispatches();
    for (const request of pending) {
      yield* locks
        .withLock(
          request.projectId,
          Effect.gen(function* () {
            const current = yield* store.getRequest({
              projectId: request.projectId,
              sourceMessageId: request.sourceMessageId,
            });
            if (current === null) return;
            if (current.status === "pending") yield* deliverInbox(current);
            else if (current.status === "dispatching") yield* executeIntent(current);
          }),
        )
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("project-coordinator.reconcile-pending", {
              projectId: request.projectId,
              requestId: request.id,
              operation: error.message,
            }),
          ),
        );
    }
    // Terminal evidence is durable, so recovery also covers a missed subscription emission.
    const workerIds = yield* sql<{
      readonly threadId: string;
    }>`SELECT DISTINCT worker_thread_id AS threadId FROM project_coordinator_requests WHERE worker_thread_id IS NOT NULL`;
    for (const { threadId } of workerIds) yield* superviseThread(ThreadId.make(threadId));
  }).pipe(
    Effect.mapError((cause) =>
      isCoordinatorError(cause) ? cause : failure("reconciliation")(cause),
    ),
  );

  const supervisionCursor = yield* events
    .latestSequence()
    .pipe(Effect.mapError(failure("notification cursor")));
  yield* threads.streamStoredEventsFrom({ afterSequence: supervisionCursor }).pipe(
    Stream.filter(
      ({ event }) =>
        (event.type === "run.updated" &&
          ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(
            event.payload.status,
          )) ||
        event.type === "runtime-request.updated",
    ),
    Stream.runForEach(({ event }) =>
      superviseThread(event.threadId).pipe(
        Effect.catch((error) =>
          Effect.logError("project-coordinator.supervision-failed", { error }),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  const readEvidence = Effect.fn("ProjectCoordinator.readEvidence")(function* (
    input: ProjectCoordinatorEvidenceInput,
  ) {
    const state = yield* read({ projectId: input.projectId });
    const selectedRequest =
      input.sourceMessageId === undefined
        ? null
        : yield* store.getRequest({
            projectId: input.projectId,
            sourceMessageId: input.sourceMessageId,
          });
    if (input.sourceMessageId !== undefined && selectedRequest === null)
      return yield* invalid("The selected user inbox message was not found.");
    const selectedNotification =
      input.notificationId === undefined
        ? null
        : (state.notifications.find(({ id }) => id === input.notificationId) ?? null);
    if (input.notificationId !== undefined && selectedNotification === null)
      return yield* invalid("The selected notification was not found.");
    const candidates = [
      ...state.requests.filter(({ status }) => status === "pending" || status === "dispatching"),
      ...state.requests
        .filter(
          ({ taskId, status }) =>
            taskId !== null && status !== "pending" && status !== "dispatching",
        )
        .toReversed(),
      ...state.requests
        .filter(
          ({ taskId, status }) =>
            taskId === null && status !== "pending" && status !== "dispatching",
        )
        .toReversed(),
    ];
    const requestRefs = candidates
      .slice(0, 30)
      .map(({ id, sourceMessageId, status, taskId, workerThreadId, error }) => ({
        id,
        sourceMessageId,
        status,
        taskId,
        workerThreadId,
        error,
      }));
    const notificationRefs = state.notifications
      .slice(0, 20)
      .map(({ id, kind, status, observedAt, taskId, workerThreadId }) => ({
        id,
        kind,
        status,
        observedAt,
        taskId,
        workerThreadId,
      }));
    return {
      projectId: state.projectId,
      threadId: state.threadId,
      contextRevision: state.contextRevision,
      decisions: state.decisions,
      requests: requestRefs,
      notifications: notificationRefs,
      request: selectedRequest,
      notification: selectedNotification,
      omittedRequests: Math.max(0, state.requests.length - requestRefs.length),
      omittedNotifications: Math.max(0, state.notifications.length - notificationRefs.length),
    };
  });

  const invoke = Effect.fn("ProjectCoordinator.invoke")(function* (input: {
    readonly callerThreadId: ThreadId;
    readonly action: CoordinatorAction;
  }) {
    const context = yield* store.readForThread(input.callerThreadId);
    if (context === null) return yield* invalid("This project's coordinator has not been opened.");
    const action = input.action;
    if (action.kind !== "route" && action.input.projectId !== context.snapshot.projectId)
      return yield* invalid("Use coordinator tools only in the calling project.");
    switch (action.kind) {
      case "read":
        return yield* readEvidence(action.input);
      case "route":
        yield* route({ callerThreadId: input.callerThreadId, route: action.input });
        return yield* readEvidence({
          projectId: context.snapshot.projectId,
          sourceMessageId: action.input.sourceMessageId,
        });
      case "decision":
        yield* recordDecision({ callerThreadId: input.callerThreadId, decision: action.input });
        return yield* readEvidence({ projectId: context.snapshot.projectId });
      case "ask":
        yield* ask({ callerThreadId: input.callerThreadId, question: action.input });
        return yield* readEvidence({
          projectId: context.snapshot.projectId,
          notificationId: action.input.id,
        });
      case "resolve":
        yield* resolveQuestion({ callerThreadId: input.callerThreadId, resolution: action.input });
        return yield* readEvidence({
          projectId: context.snapshot.projectId,
          notificationId: action.input.id,
        });
      case "observe":
        yield* store.observeNotification(action.input);
        return yield* readEvidence({
          projectId: context.snapshot.projectId,
          notificationId: action.input.id,
        });
    }
  });

  return ProjectCoordinatorService.of({
    invoke,
    open,
    read,
    subscribe: store.subscribe,
    send,
    route,
    recordDecision,
    ask,
    resolveQuestion,
    observeNotification: (input) =>
      store
        .observeNotification(input)
        .pipe(Effect.andThen(store.read({ projectId: input.projectId }))),
    reconcile,
  });
});

export const layer = Layer.effect(ProjectCoordinatorService, make);
