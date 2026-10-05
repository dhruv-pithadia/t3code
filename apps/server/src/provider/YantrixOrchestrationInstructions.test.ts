import { assert, describe, it } from "@effect/vitest";

import {
  YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS,
  yantrixAcpPromptWithInstructions,
  yantrixOrchestrationPromptForFirstRun,
  yantrixOrchestrationSystemPrompt,
} from "./YantrixOrchestrationInstructions.ts";

describe("Yantrix orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(
      YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS,
      "ordinary top-level Yantrix conversations",
    );
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `yantrix_thread_send` on `childThreadId`",
    );
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(
      YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS,
      "structured object, never as JSON text",
    );
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = yantrixOrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasYantrixMcp: true,
    });

    assert.include(injected, "<yantrix_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      yantrixOrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasYantrixMcp: true }),
      prompt,
    );
    assert.equal(
      yantrixOrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasYantrixMcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the Yantrix MCP server is attached", () => {
    assert.equal(yantrixOrchestrationSystemPrompt(false), undefined);
    assert.equal(yantrixOrchestrationSystemPrompt(true), YANTRIX_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = yantrixAcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasYantrixMcp: true },
    });

    assert.include(injected, "Yantrix interaction mode: Default");
    assert.include(injected, "Yantrix collaborative browser");
    assert.include(injected, "Yantrix orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasYantrixMcp: true } as const;

    assert.equal(
      yantrixAcpPromptWithInstructions({
        prompt,
        state: defaultState,
        previousState: defaultState,
      }),
      prompt,
    );
    assert.include(
      yantrixAcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "Yantrix interaction mode: Plan",
    );
    const withoutMcp = yantrixAcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasYantrixMcp: false },
    });
    assert.include(withoutMcp, "Yantrix interaction mode: Default");
    assert.notInclude(withoutMcp, "Yantrix collaborative browser");
    assert.notInclude(withoutMcp, "Yantrix orchestration");
  });
});
