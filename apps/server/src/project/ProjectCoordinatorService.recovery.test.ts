import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as FeatureTasks from "../featureTasks/FeatureTaskService.ts";
import * as Recovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import * as RestartContinuation from "../orchestration-v2/RestartContinuation.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Coordinator from "./ProjectCoordinatorService.ts";
import * as CoordinatorStore from "./ProjectCoordinatorStore.ts";
import {
  completeRun,
  makeRecoveryHarness,
  modelSelection,
  projectId,
  seedProject,
} from "./ProjectCoordinatorService.recovery.testkit.ts";

// Each session recreates coordinator services while retaining the same SQLite and orchestration runtime.
const session = Coordinator.layer.pipe(Layer.provide(CoordinatorStore.layer));

it.effect(
  "replays a launch whose acceptance response was lost without duplicating its task, worker, or run",
  () => {
    const harness = makeRecoveryHarness({ loseFirstWorkerLaunchResult: true });
    return Effect.gen(function* () {
      yield* seedProject;
      const intent = "Build a keypad with digits 0 through 9. Do not add operators.";
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const opened = yield* service.open({ projectId, modelSelection });
          assert.isNotNull(opened.threadId);
          const sent = yield* service.send({
            projectId,
            requestId: "keypad-request",
            text: intent,
          });
          const request = sent.snapshot.requests[0]!;
          const route = {
            sourceMessageId: request.sourceMessageId,
            kind: "new_task" as const,
            title: "Digit keypad",
            objective: "Use accessible digit buttons.",
          };
          const result = yield* Effect.result(
            service.route({ callerThreadId: opened.threadId!, route }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.equal(result.failure.code, "storage");
          const persisted = (yield* service.read({ projectId })).requests[0]!;
          assert.equal(persisted.status, "dispatching");
          assert.equal(persisted.text, intent);
          assert.isNotNull(persisted.error);
          assert.isNotNull(persisted.taskId);
          assert.isNotNull(persisted.workerThreadId);
          const threads = yield* Threads.ThreadManagementService;
          const worker = yield* threads.getThreadProjection(persisted.workerThreadId!);
          assert.lengthOf(worker.runs, 1);
          assert.lengthOf(worker.messages, 1);
          return {
            coordinatorThreadId: opened.threadId!,
            route,
            request: persisted,
            runId: worker.runs[0]!.id,
            messageId: worker.messages[0]!.id,
          };
        }).pipe(Effect.provide(session)),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          const replayed = yield* service.route({
            callerThreadId: saved.coordinatorThreadId,
            route: saved.route,
          });
          const request = replayed.requests.find(({ id }) => id === saved.request.id)!;
          assert.equal(request.status, "dispatched");
          assert.equal(request.taskId, saved.request.taskId);
          assert.equal(request.workerThreadId, saved.request.workerThreadId);
          assert.equal(request.commandId, saved.request.commandId);
          assert.deepEqual(request.routePayload, saved.request.routePayload);
          const tasks = yield* FeatureTasks.FeatureTaskService;
          const listed = yield* tasks.list({ projectId });
          assert.lengthOf(listed.tasks, 1);
          assert.equal(listed.tasks[0]!.objective, intent);
          assert.deepEqual(listed.tasks[0]!.threadIds, [saved.request.workerThreadId!]);
          const threads = yield* Threads.ThreadManagementService;
          const worker = yield* threads.getThreadProjection(request.workerThreadId!);
          assert.lengthOf(worker.runs, 1);
          assert.lengthOf(worker.messages, 1);
          assert.equal(worker.runs[0]!.id, saved.runId);
          assert.equal(worker.messages[0]!.id, saved.messageId);
          assert.include(worker.messages[0]!.text, `Original user request:\n${intent}`);
          const workerLaunches = harness.launchCalls.filter(
            ({ initialMessage }) => initialMessage !== undefined,
          );
          assert.lengthOf(workerLaunches, 2);
          assert.equal(workerLaunches[0]!.commandId, workerLaunches[1]!.commandId);
          assert.deepEqual(workerLaunches[0]!.initialMessage, workerLaunches[1]!.initialMessage);
        }).pipe(Effect.provide(session)),
      );
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect(
  "keeps interrupted and held coordinator questions pending and reports their stopped delivery after restart",
  () => {
    const harness = makeRecoveryHarness();
    return Effect.gen(function* () {
      yield* seedProject;
      const threadId = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const opened = yield* service.open({ projectId, modelSelection });
          yield* service.send({
            projectId,
            requestId: "first-question",
            text: "Which files own the keypad behavior?",
          });
          yield* service.send({
            projectId,
            requestId: "second-question",
            text: "Can we keep the existing task branch?",
          });
          return opened.threadId!;
        }).pipe(Effect.provide(session)),
      );
      const recovery = yield* Recovery.ProviderRuntimeRecoveryService;
      yield* recovery.reconcile("startup");
      const threads = yield* Threads.ThreadManagementService;
      const before = yield* threads.getThreadProjection(threadId);
      assert.equal(before.runs[0]!.status, "cancelled");
      assert.isTrue(before.runs[1]!.queueHeld);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          yield* service.reconcile;
          const snapshot = yield* service.read({ projectId });
          assert.lengthOf(snapshot.requests, 2);
          assert.deepEqual(
            snapshot.requests.map(({ status }) => status),
            ["pending", "pending"],
          );
          assert.deepEqual(
            snapshot.requests.map(({ text }) => text),
            ["Which files own the keypad behavior?", "Can we keep the existing task branch?"],
          );
          assert.isTrue(
            snapshot.requests.every(({ error }) =>
              error?.includes("stopped or held after restart"),
            ),
          );
          assert.lengthOf(
            snapshot.notifications.filter(({ kind }) => kind === "dispatch_blocked"),
            2,
          );
          const after = yield* threads.getThreadProjection(threadId);
          assert.deepEqual(
            after.runs.map(({ id }) => id),
            before.runs.map(({ id }) => id),
          );
          assert.deepEqual(
            after.messages.map(({ id }) => id),
            before.messages.map(({ id }) => id),
          );
        }).pipe(Effect.provide(session)),
      );
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect(
  "continues a feature after restart in its existing worker and task workspace with the original follow-up text",
  () => {
    const harness = makeRecoveryHarness();
    return Effect.gen(function* () {
      yield* seedProject;
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const opened = yield* service.open({ projectId, modelSelection });
          const sent = yield* service.send({
            projectId,
            requestId: "feature-before-restart",
            text: "Implement a compact keypad.",
          });
          const routed = yield* service.route({
            callerThreadId: opened.threadId!,
            route: {
              sourceMessageId: sent.snapshot.requests[0]!.sourceMessageId,
              kind: "new_task",
              title: "Compact keypad",
            },
          });
          const request = routed.requests[0]!;
          const tasks = yield* FeatureTasks.FeatureTaskService;
          const { task } = yield* tasks.get({ id: request.taskId! });
          return {
            coordinatorThreadId: opened.threadId!,
            task,
            workerThreadId: request.workerThreadId!,
          };
        }).pipe(Effect.provide(session)),
      );
      yield* (yield* Recovery.ProviderRuntimeRecoveryService).reconcile("startup");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          const original = "Change orange buttons to teal, and continue the same feature.";
          const sent = yield* service.send({
            projectId,
            requestId: "follow-up-after-restart",
            text: original,
          });
          const followUp = sent.snapshot.requests.find(
            ({ id }) => id === "follow-up-after-restart",
          )!;
          const routed = yield* service.route({
            callerThreadId: saved.coordinatorThreadId,
            route: {
              sourceMessageId: followUp.sourceMessageId,
              kind: "follow_up",
              taskId: saved.task.id,
              objective: "A planning proposal must not replace the user's words.",
            },
          });
          const request = routed.requests.find(({ id }) => id === followUp.id)!;
          assert.equal(request.status, "dispatched");
          assert.equal(request.workerThreadId, saved.workerThreadId);
          assert.equal(request.taskId, saved.task.id);
          assert.equal(request.text, original);
          const tasks = yield* FeatureTasks.FeatureTaskService;
          const listed = yield* tasks.list({ projectId });
          assert.lengthOf(listed.tasks, 1);
          assert.deepEqual(listed.tasks[0]!.workspace, saved.task.workspace);
          assert.deepEqual(listed.tasks[0]!.threadIds, [saved.workerThreadId]);
          const threads = yield* Threads.ThreadManagementService;
          const worker = yield* threads.getThreadProjection(saved.workerThreadId);
          assert.equal(worker.thread.worktreePath, saved.task.workspace!.worktreePath);
          assert.equal(worker.thread.branch, saved.task.workspace!.branch);
          assert.lengthOf(worker.messages, 2);
          assert.equal(worker.messages[1]!.text, original);
          assert.equal(worker.runs[0]!.status, "cancelled");
          assert.equal(worker.runs[1]!.userMessageId, worker.messages[1]!.id);
          assert.lengthOf(
            harness.launchCalls.filter(({ initialMessage }) => initialMessage !== undefined),
            1,
          );
          assert.lengthOf(harness.workspaceChecks, 1);
        }).pipe(Effect.provide(session)),
      );
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("queues a follow-up on the existing worker without creating another worker", () => {
  const harness = makeRecoveryHarness();
  return Effect.gen(function* () {
    yield* seedProject;
    const service = yield* Coordinator.ProjectCoordinatorService;
    const opened = yield* service.open({ projectId, modelSelection });
    const first = yield* service.send({
      projectId,
      requestId: "active-feature",
      text: "Implement the keypad.",
    });
    const routed = yield* service.route({
      callerThreadId: opened.threadId!,
      route: {
        sourceMessageId: first.snapshot.requests[0]!.sourceMessageId,
        kind: "new_task",
        title: "Keypad",
      },
    });
    const taskId = routed.requests[0]!.taskId!;
    const workerThreadId = routed.requests[0]!.workerThreadId!;
    const followup = yield* service.send({
      projectId,
      requestId: "queued-follow-up",
      text: "Keep the buttons teal.",
    });
    const final = yield* service.route({
      callerThreadId: opened.threadId!,
      route: {
        sourceMessageId: followup.snapshot.requests.find(({ id }) => id === "queued-follow-up")!
          .sourceMessageId,
        kind: "follow_up",
        taskId,
      },
    });
    assert.equal(final.requests.find(({ id }) => id === "queued-follow-up")!.status, "dispatched");
    const worker = yield* (yield* Threads.ThreadManagementService).getThreadProjection(
      workerThreadId,
    );
    assert.lengthOf(worker.runs, 2);
    assert.equal(worker.runs[1]!.status, "queued");
    assert.equal(worker.runs[0]!.status, "preparing");
    assert.equal(worker.messages[1]!.text, "Keep the buttons teal.");
    const taskList = yield* (yield* FeatureTasks.FeatureTaskService).list({ projectId });
    assert.lengthOf(taskList.tasks, 1);
    assert.lengthOf(
      harness.launchCalls.filter(({ initialMessage }) => initialMessage !== undefined),
      1,
    );
  }).pipe(Effect.provide(session.pipe(Layer.provideMerge(harness.layer))));
});

it.effect(
  "preserves a pending product decision after investigation completion and observation until a later user answer resolves it",
  () => {
    const harness = makeRecoveryHarness();
    return Effect.gen(function* () {
      yield* seedProject;
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const opened = yield* service.open({ projectId, modelSelection });
          const sent = yield* service.send({
            projectId,
            requestId: "investigation",
            text: "Investigate the keypad layout options before implementation.",
          });
          const sourceMessageId = sent.snapshot.requests[0]!.sourceMessageId;
          const routed = yield* service.route({
            callerThreadId: opened.threadId!,
            route: { sourceMessageId, kind: "new_task", title: "Investigate keypad layout" },
          });
          yield* service.ask({
            callerThreadId: opened.threadId!,
            question: {
              projectId,
              id: "layout-choice",
              sourceMessageId,
              summary: "Should the keypad use three columns or four?",
            },
          });
          const workerThreadId = routed.requests[0]!.workerThreadId!;
          const threads = yield* Threads.ThreadManagementService;
          const worker = yield* threads.getThreadProjection(workerThreadId);
          return {
            coordinatorThreadId: opened.threadId!,
            sourceMessageId,
            workerThreadId,
            run: worker.runs[0]!,
          };
        }).pipe(Effect.provide(session)),
      );
      // The result commits while the coordinator subscriber is stopped.
      yield* completeRun(saved.workerThreadId, saved.run);
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          const snapshot = yield* service.read({ projectId });
          assert.lengthOf(
            snapshot.notifications.filter(({ kind }) => kind === "worker_completed"),
            1,
          );
          yield* service.reconcile;
          const threads = yield* Threads.ThreadManagementService;
          const coordinatorThread = yield* threads.getThreadProjection(saved.coordinatorThreadId);
          assert.lengthOf(
            coordinatorThread.messages.filter(({ text }) =>
              text.startsWith("Persisted worker notification "),
            ),
            1,
          );
          const pending = snapshot.notifications.find(({ id }) => id === "layout-choice")!;
          assert.equal(pending.status, "pending");
          assert.isNull(pending.resolvedAt);
          const observed = yield* service.observeNotification({ projectId, id: pending.id });
          const stillPending = observed.notifications.find(({ id }) => id === pending.id)!;
          assert.isNotNull(stillPending.observedAt);
          assert.equal(stillPending.status, "pending");
          assert.isNull(stillPending.resolutionMessageId);
          const invalidAnswer = yield* Effect.result(
            service.resolveQuestion({
              callerThreadId: saved.coordinatorThreadId,
              resolution: { projectId, id: pending.id, resolutionMessageId: saved.sourceMessageId },
            }),
          );
          assert.isTrue(Result.isFailure(invalidAnswer));
        }).pipe(Effect.provide(session)),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const reopened = yield* service.read({ projectId });
          const question = reopened.notifications.find(({ id }) => id === "layout-choice")!;
          assert.equal(question.status, "pending");
          assert.isNotNull(question.observedAt);
          const answer = yield* service.send({
            projectId,
            requestId: "layout-answer",
            text: "Use three columns.",
          });
          const answerMessageId = answer.snapshot.requests.find(
            ({ id }) => id === "layout-answer",
          )!.sourceMessageId;
          const resolved = yield* service.resolveQuestion({
            callerThreadId: saved.coordinatorThreadId,
            resolution: { projectId, id: question.id, resolutionMessageId: answerMessageId },
          });
          const decision = resolved.notifications.find(({ id }) => id === question.id)!;
          assert.equal(decision.status, "resolved");
          assert.isNotNull(decision.resolvedAt);
          assert.equal(decision.resolutionMessageId, answerMessageId);
        }).pipe(Effect.provide(session)),
      );
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect(
  "correlates opt-in restart continuation completion with the original task and clears only its dispatch blocker",
  () => {
    const harness = makeRecoveryHarness({
      loseFirstWorkerLaunchResult: true,
      continueThreadsAfterServerUpdate: true,
    });
    return Effect.gen(function* () {
      yield* seedProject;
      const saved = yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          const opened = yield* service.open({ projectId, modelSelection });
          const sent = yield* service.send({
            projectId,
            requestId: "continue-interrupted-feature",
            text: "Implement the digit keypad in its task workspace.",
          });
          const sourceMessageId = sent.snapshot.requests[0]!.sourceMessageId;
          const attempted = yield* Effect.result(
            service.route({
              callerThreadId: opened.threadId!,
              route: { sourceMessageId, kind: "new_task", title: "Resumable digit keypad" },
            }),
          );
          assert.isTrue(Result.isFailure(attempted));
          const request = (yield* service.read({ projectId })).requests[0]!;
          const threads = yield* Threads.ThreadManagementService;
          const worker = yield* threads.getThreadProjection(request.workerThreadId!);
          const tasks = yield* FeatureTasks.FeatureTaskService;
          const { task } = yield* tasks.get({ id: request.taskId! });
          return { coordinatorThreadId: opened.threadId!, request, task, run: worker.runs[0]! };
        }).pipe(Effect.provide(session)),
      );

      yield* (yield* Recovery.ProviderRuntimeRecoveryService).reconcile("startup");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          const blocked = yield* service.read({ projectId });
          assert.equal(blocked.requests[0]!.status, "blocked");
          assert.isTrue(
            blocked.notifications.some(
              ({ kind, status }) => kind === "dispatch_blocked" && status === "pending",
            ),
          );
          yield* service.ask({
            callerThreadId: saved.coordinatorThreadId,
            question: {
              projectId,
              id: "continuation-product-question",
              sourceMessageId: saved.request.sourceMessageId,
              summary: "Should the digit keypad include a decimal button?",
            },
          });
          yield* service.observeNotification({ projectId, id: "continuation-product-question" });
        }).pipe(Effect.provide(session)),
      );

      // Invoke the real opt-in delivery service without executing a provider subprocess.
      yield* RestartContinuation.continueRestartedRun({
        threadId: saved.request.workerThreadId!,
        sourceRunId: saved.run.id,
      });
      yield* RestartContinuation.continueRestartedRun({
        threadId: saved.request.workerThreadId!,
        sourceRunId: saved.run.id,
      });
      const threads = yield* Threads.ThreadManagementService;
      const resumed = yield* threads.getThreadProjection(saved.request.workerThreadId!);
      assert.lengthOf(resumed.runs, 2);
      assert.lengthOf(resumed.messages, 2);
      const continuation = resumed.runs.find(
        ({ restartContinuationOfRunId }) => restartContinuationOfRunId === saved.run.id,
      )!;
      assert.isDefined(continuation);
      assert.notEqual(continuation.userMessageId, saved.run.userMessageId);
      yield* completeRun(saved.request.workerThreadId!, continuation);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const service = yield* Coordinator.ProjectCoordinatorService;
          yield* service.reconcile;
          yield* service.reconcile;
          const snapshot = yield* service.read({ projectId });
          const request = snapshot.requests.find(({ id }) => id === saved.request.id)!;
          assert.equal(request.status, "dispatched");
          assert.isNull(request.error);
          assert.equal(request.taskId, saved.task.id);
          assert.equal(request.workerThreadId, saved.request.workerThreadId);
          const completed = snapshot.notifications.filter(
            ({ kind }) => kind === "worker_completed",
          );
          assert.lengthOf(completed, 1);
          assert.equal(completed[0]!.sourceMessageId, saved.request.sourceMessageId);
          assert.equal(completed[0]!.taskId, saved.task.id);
          assert.isTrue(
            snapshot.notifications
              .filter(({ kind }) => kind === "dispatch_blocked")
              .every(({ status }) => status === "resolved"),
          );
          const question = snapshot.notifications.find(
            ({ id }) => id === "continuation-product-question",
          )!;
          assert.equal(question.status, "pending");
          assert.isNotNull(question.observedAt);
          assert.isNull(question.resolvedAt);
          const tasks = yield* FeatureTasks.FeatureTaskService;
          const listed = yield* tasks.list({ projectId });
          assert.lengthOf(listed.tasks, 1);
          assert.deepEqual(listed.tasks[0]!.workspace, saved.task.workspace);
          assert.deepEqual(listed.tasks[0]!.threadIds, [saved.request.workerThreadId!]);
          assert.lengthOf(
            (yield* threads.getThreadProjection(saved.request.workerThreadId!)).runs,
            2,
          );
        }).pipe(Effect.provide(session)),
      );
    }).pipe(Effect.provide(harness.layer));
  },
);
