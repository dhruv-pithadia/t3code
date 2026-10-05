import { FeatureTaskId, ProjectId, ThreadId, type FeatureTask } from "@yantrix/contracts";
import { expect, it } from "vite-plus/test";

import { formatFeatureTaskContext } from "./featureTaskContext.ts";

const task: FeatureTask = {
  id: FeatureTaskId.make("task-continuity"),
  projectId: ProjectId.make("project-yantrix"),
  title: "Recover interrupted work",
  objective: "Resume the correct feature after reopening the app",
  acceptanceCriteria: ["Keep the same workspace", "Recover the latest decision"],
  decisions: ["Merge approval stays with the user"],
  nextAction: "Verify restart recovery",
  handoff: "Task persistence is implemented; verification is pending",
  threadIds: [ThreadId.make("conversation-one")],
  status: "verifying",
  archivedAt: null,
  version: 3,
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T01:00:00.000Z",
};

it("carries current task intent and conversation references without claiming verification", () => {
  const text = formatFeatureTaskContext(task);
  expect(text).toContain(task.objective);
  expect(text).toContain(task.nextAction);
  expect(text).toContain(task.decisions[0]);
  expect(text).toContain(task.threadIds[0]);
  expect(text).toContain('"version":3');
  expect(text).toContain("does not prove");
  expect(text).toContain("Merge approval remains with the user");
});

it("does not inject archived task intent into later conversation work", () => {
  expect(formatFeatureTaskContext({ ...task, archivedAt: task.updatedAt })).toBe("");
});

it("bounds repeated context and directs the agent to retrieve omitted task details", () => {
  const text = formatFeatureTaskContext({ ...task, handoff: "😀".repeat(16_000) });
  expect(Array.from(text).length).toBeLessThan(17_000);
  expect(text).toContain("Task context was shortened");
  expect(text).toContain("yantrix_feature_task_read");
  expect(text).not.toContain("\uFFFD");
});
