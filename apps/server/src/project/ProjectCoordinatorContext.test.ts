import { assert, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ThreadId,
  type ProjectCoordinatorSnapshot,
} from "@yantrix/contracts";
import { formatProjectCoordinatorContext } from "./ProjectCoordinatorContext.ts";

const now = "2026-10-07T00:00:00.000Z";
const base: ProjectCoordinatorSnapshot = {
  projectId: ProjectId.make("project:context-budget"),
  threadId: ThreadId.make("thread:context-budget"),
  modelSelection: null,
  contextRevision: 0,
  decisions: [],
  requests: [],
  notifications: [],
};

it("bounds optional startup references while preserving observed unresolved questions", () => {
  const snapshot: ProjectCoordinatorSnapshot = {
    ...base,
    requests: Array.from({ length: 500 }, (_, index) => ({
      id: `request:${index}:${"x".repeat(150)}`,
      projectId: base.projectId,
      sequence: index + 1,
      sourceMessageId: MessageId.make(`message:${index}:${"y".repeat(150)}`),
      text: "Original user text.".repeat(1500),
      status: "pending",
      route: null,
      taskId: null,
      workerThreadId: null,
      commandId: null,
      routePayload: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    })),
    notifications: [
      {
        id: "pending-question",
        taskId: null,
        workerThreadId: null,
        sourceMessageId: MessageId.make("source:question"),
        runtimeRequestId: null,
        kind: "pending_decision",
        summary: "Should the calculator accept keyboard input?",
        status: "pending",
        observedAt: now,
        resolvedAt: null,
        resolutionMessageId: null,
        createdAt: now,
      },
    ],
  };
  const packet = formatProjectCoordinatorContext(
    snapshot,
    true,
    snapshot.requests[499]!.sourceMessageId,
  );
  assert.isBelow(packet.length, 20_000);
  assert.include(packet, "Additional references omitted:");
  assert.include(packet, "pending-question");
  assert.include(packet, "Current message identity:");
  assert.notInclude(packet, "Original user text.");
  assert.include(packet, "it creates no implementation task");
});

it("refuses to silently truncate mandatory accepted project decisions", () => {
  const snapshot: ProjectCoordinatorSnapshot = {
    ...base,
    decisions: Array.from({ length: 4 }, (_, index) => ({
      id: `decision:${index}`,
      text: "d".repeat(4000),
      sourceMessageId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })),
  };
  assert.throws(
    () => formatProjectCoordinatorContext(snapshot, false),
    "Accepted project direction exceeds the startup context budget",
  );
});
