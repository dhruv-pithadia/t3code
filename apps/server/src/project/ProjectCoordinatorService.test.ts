import { assert, it } from "@effect/vitest";
import { CommandId, ThreadId } from "@yantrix/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import * as FeatureTasks from "../featureTasks/FeatureTaskService.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import { formatProjectCoordinatorContext } from "./ProjectCoordinatorContext.ts";
import * as Coordinator from "./ProjectCoordinatorService.ts";
import * as CoordinatorStore from "./ProjectCoordinatorStore.ts";
import {
  makeRecoveryHarness,
  modelSelection,
  projectId,
  seedProject,
} from "./ProjectCoordinatorService.recovery.testkit.ts";

const session = Coordinator.layer.pipe(Layer.provide(CoordinatorStore.layer));

it.effect(
  "opens one native coordinator and answers an informational request without a coding task",
  () => {
    const harness = makeRecoveryHarness();
    return Effect.gen(function* () {
      yield* seedProject;
      const service = yield* Coordinator.ProjectCoordinatorService;
      const unopened = yield* service.read({ projectId });
      assert.isNull(unopened.threadId);
      const first = yield* service.open({ projectId, modelSelection });
      const reopened = yield* service.open({ projectId, modelSelection });
      assert.equal(reopened.threadId, first.threadId);
      assert.lengthOf(harness.launchCalls, 1);
      const request = (yield* service.send({
        projectId,
        requestId: "informational",
        text: "What are we building next?",
      })).snapshot.requests[0]!;
      const result = yield* service.invoke({
        callerThreadId: first.threadId!,
        action: {
          kind: "route",
          input: { sourceMessageId: request.sourceMessageId, kind: "discussion" },
        },
      });
      assert.equal(result.request?.status, "discussed");
      assert.isNull(result.request?.taskId);
      const tasks = yield* FeatureTasks.FeatureTaskService;
      assert.lengthOf((yield* tasks.list({ projectId })).tasks, 0);
      assert.lengthOf(harness.launchCalls, 1);
      const replay = yield* service.send({
        projectId,
        requestId: "informational",
        text: request.text,
      });
      assert.lengthOf(replay.snapshot.requests, 1);
    }).pipe(Effect.provide(session.pipe(Layer.provideMerge(harness.layer))));
  },
);

it.effect(
  "makes an explicit correction available to a fresh project chat and rejects a worker's decision mutation",
  () => {
    const harness = makeRecoveryHarness();
    return Effect.gen(function* () {
      yield* seedProject;
      const service = yield* Coordinator.ProjectCoordinatorService;
      const opened = yield* service.open({ projectId, modelSelection });
      const source = (yield* service.send({
        projectId,
        requestId: "direction",
        text: "Use vanilla JavaScript for this project.",
      })).snapshot.requests[0]!;
      const direction = yield* service.recordDecision({
        callerThreadId: opened.threadId!,
        decision: {
          projectId,
          id: "implementation-language",
          text: "Use vanilla JavaScript.",
          sourceMessageId: source.sourceMessageId,
          expectedContextRevision: 0,
        },
      });
      assert.equal(direction.contextRevision, 1);
      const ordinaryThread = ThreadId.make("thread:coordinator-fresh-chat");
      const threads = yield* Threads.ThreadManagementService;
      yield* threads.dispatch({
        type: "thread.create",
        commandId: CommandId.make("command:coordinator-fresh-chat"),
        threadId: ordinaryThread,
        projectId,
        title: "Fresh conversation",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        createdBy: "user",
        creationSource: "web",
      });
      const store = yield* CoordinatorStore.ProjectCoordinatorStore;
      const context = yield* store.readForThread(ordinaryThread);
      assert.isNotNull(context);
      assert.isFalse(context!.isCoordinator);
      const packet = formatProjectCoordinatorContext(context!.snapshot, false);
      assert.include(packet, "Use vanilla JavaScript.");
      assert.include(packet, "not evidence that code implements them");
      assert.notInclude(packet, "You are this project's Yantrix coordinator");
      const denied = yield* Effect.result(
        service.recordDecision({
          callerThreadId: ordinaryThread,
          decision: {
            projectId,
            id: "implementation-language",
            text: "Switch to a worker's inferred plan.",
            sourceMessageId: source.sourceMessageId,
            expectedContextRevision: 1,
          },
        }),
      );
      assert.isTrue(Result.isFailure(denied));
      assert.equal(
        (yield* service.read({ projectId })).decisions[0]!.text,
        "Use vanilla JavaScript.",
      );
    }).pipe(Effect.provide(session.pipe(Layer.provideMerge(harness.layer))));
  },
);
