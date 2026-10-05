import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, ThreadId, type ModelSelection } from "@yantrix/contracts";

import { latestAvailableTaskThread, selectFeatureTaskConversationModel } from "./TaskPage.logic";

const firstThreadId = ThreadId.make("first-thread");
const secondThreadId = ThreadId.make("second-thread");
const model = (name: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: name,
});

describe("feature task conversation helpers", () => {
  it("resumes the newest available linked conversation and skips missing refs", () => {
    const latest = {
      threadId: secondThreadId,
      thread: {
        id: secondThreadId,
        updatedAt: "2026-10-05T11:00:00.000Z",
        modelSelection: model("gpt-5"),
        branch: null,
        worktreePath: null,
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
      },
    };
    expect(
      latestAvailableTaskThread([
        { threadId: firstThreadId, thread: null },
        {
          threadId: firstThreadId,
          thread: {
            id: firstThreadId,
            updatedAt: "2026-10-05T10:00:00.000Z",
            modelSelection: model("gpt-4.1"),
            branch: null,
            worktreePath: null,
            runtimeMode: "full-access" as const,
            interactionMode: "default" as const,
          },
        },
        latest,
      ]),
    ).toBe(latest);
  });

  it("prefers the latest conversation model and falls back to a valid project model", () => {
    const projectModel = model("gpt-5");
    expect(
      selectFeatureTaskConversationModel({ modelSelection: model("gpt-4.1") }, projectModel),
    ).toEqual(model("gpt-4.1"));
    expect(selectFeatureTaskConversationModel(null, projectModel)).toEqual(projectModel);
  });

  it("does not dispatch the empty no-provider model sentinel", () => {
    expect(selectFeatureTaskConversationModel(null, model("  "))).toBeNull();
  });
});
