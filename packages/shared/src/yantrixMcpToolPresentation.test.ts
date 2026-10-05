import { describe, expect, it } from "vite-plus/test";

import {
  YANTRIX_MCP_TOOL_NAMES,
  resolveYantrixMcpToolPresentation,
} from "./yantrixMcpToolPresentation.ts";

describe("resolveYantrixMcpToolPresentation", () => {
  it("recognizes every Yantrix tool across provider prefixes and completion suffixes", () => {
    for (const tool of YANTRIX_MCP_TOOL_NAMES) {
      const presentation = resolveYantrixMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__yantrix__",
        "mcp__yantrix__",
        "mcp__yantrix__",
        "Yantrix.",
        "yantrix/",
        "yantrix:",
        "mcp_yantrix_",
        "Yantrix ",
        "yantrix · ",
      ]) {
        expect(resolveYantrixMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveYantrixMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor Yantrix MCP tool names", () => {
    expect(resolveYantrixMcpToolPresentation("mcp__yantrix__yantrix_thread_read")).toEqual({
      displayName: "Read a Yantrix thread",
      logo: "yantrix",
    });
  });

  it("pretty prints Codex Yantrix MCP tool names", () => {
    expect(resolveYantrixMcpToolPresentation("yantrix.create_threads")).toEqual({
      displayName: "Create Yantrix threads",
      logo: "yantrix",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveYantrixMcpToolPresentation("mcp__yantrix__yantrix_thread_update")).toEqual({
      displayName: "Update Yantrix thread metadata",
      logo: "yantrix",
    });
  });

  it("pretty prints bare Yantrix MCP toolkit names", () => {
    expect(resolveYantrixMcpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "yantrix",
    });
  });

  it("pretty prints worktree Yantrix MCP tool names", () => {
    expect(resolveYantrixMcpToolPresentation("mcp__yantrix__yantrix_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "yantrix",
    });
    expect(resolveYantrixMcpToolPresentation("yantrix.yantrix_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "yantrix",
    });
  });

  it("pretty prints preview Yantrix MCP tool names", () => {
    expect(resolveYantrixMcpToolPresentation("Yantrix.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "yantrix",
    });
    expect(resolveYantrixMcpToolPresentation("mcp__yantrix__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "yantrix",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_yantrix_delegate_task",
      "yantrix:delegate_task",
      "yantrix/delegate_task",
      "yantrix delegate_task",
      "Yantrix delegate_task",
      "yantrix__delegate_task",
    ]) {
      expect(resolveYantrixMcpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveYantrixMcpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveYantrixMcpToolPresentation("yantrix.not_a_real_tool")).toBeNull();
  });
});
