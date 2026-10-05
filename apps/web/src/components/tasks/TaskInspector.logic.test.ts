import type {
  FeatureTaskDelivery,
  FeatureTaskWorkspaceBinding,
  FeatureTaskWorkspaceResult,
} from "@yantrix/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildChatRows,
  deriveDeliverySummary,
  deriveWorkspaceHealth,
  resolveDockedInspectorOpen,
  worktreeBasename,
} from "./TaskInspector.logic";

const binding: FeatureTaskWorkspaceBinding = {
  repoPath: "/repo",
  worktreePath: "/repo-worktrees/task-one",
  branch: "task/one",
  createdAt: "2026-10-05T00:00:00.000Z",
};
const ready: FeatureTaskWorkspaceResult = { state: "ready", binding, recoveryAvailable: false };

describe("docked inspector visibility", () => {
  it("follows the viewport until the user chooses, and never docks when narrow", () => {
    expect(resolveDockedInspectorOpen("auto", true)).toBe(true);
    expect(resolveDockedInspectorOpen("closed", true)).toBe(false);
    expect(resolveDockedInspectorOpen("open", true)).toBe(true);
    expect(resolveDockedInspectorOpen("open", false)).toBe(false);
  });
});

describe("worktree names", () => {
  it("shortens POSIX and Windows paths", () => {
    expect(worktreeBasename("/a/b/task-one/")).toBe("task-one");
    expect(worktreeBasename("C:\\work\\task-two")).toBe("task-two");
    expect(worktreeBasename("/")).toBe("/");
  });
});

describe("workspace health", () => {
  const base = { supported: true, binding, workspace: ready, error: null, isPending: false };

  it("reports ready only when the latest inspection is complete", () => {
    expect(deriveWorkspaceHealth(base)).toMatchObject({ kind: "known", label: "Ready" });
    const pending = deriveWorkspaceHealth({ ...base, isPending: true });
    expect(pending).toMatchObject({ kind: "checking", tone: "neutral", needsAttention: false });
    expect(pending.label).not.toMatch(/ready/i);
    const failed = deriveWorkspaceHealth({ ...base, error: "offline" });
    expect(failed).toMatchObject({ kind: "stale", tone: "unknown", needsAttention: true });
  });

  it("flags broken workspaces for attention and a task on an unverifiable host", () => {
    const missing = deriveWorkspaceHealth({
      ...base,
      workspace: { state: "missing", binding, recoveryAvailable: true },
    });
    expect(missing.needsAttention).toBe(true);
    expect(deriveWorkspaceHealth({ ...base, supported: false }).needsAttention).toBe(true);
    expect(deriveWorkspaceHealth({ ...base, supported: false, binding: null }).needsAttention).toBe(
      false,
    );
  });
});

describe("delivery summary", () => {
  const delivery: FeatureTaskDelivery = {
    pullRequest: {
      number: 12,
      title: "t",
      url: "https://example.test/12",
      state: "open",
      headBranch: "task/one",
      baseBranch: "main",
    },
    checks: "failing",
    mergeState: "open",
    updatedAt: "2026-10-05T00:00:00.000Z",
  };
  const base = { hasWorkspace: true, delivery, error: null, isPending: false };

  it("summarizes aggregate state and marks facts from before a failed refresh", () => {
    expect(deriveDeliverySummary(base)).toMatchObject({
      label: "PR #12 · Checks failing",
      tone: "danger",
      stale: false,
    });
    expect(deriveDeliverySummary({ ...base, error: "offline" })).toMatchObject({
      label: "Last known: PR #12 · Checks failing",
      stale: true,
    });
    expect(deriveDeliverySummary({ ...base, hasWorkspace: false }).label).toBe("Not set up");
  });

  it("does not present cached facts as current while a refresh is pending", () => {
    const pending = deriveDeliverySummary({ ...base, isPending: true });
    expect(pending).toMatchObject({
      label: "Last known: PR #12 · Checks failing",
      tone: "unknown",
      stale: true,
      checking: true,
    });
    expect(deriveDeliverySummary({ ...base, delivery: null, isPending: true })).toMatchObject({
      label: "Checking delivery",
      checking: true,
    });
    expect(deriveDeliverySummary({ ...base, error: "offline", isPending: true }).checking).toBe(
      false,
    );
  });
});

describe("chat rows", () => {
  const thread = (updatedAt: string, worktreePath: string | null, branch: string | null) => ({
    title: "t",
    updatedAt,
    worktreePath,
    branch,
    modelSelection: { instanceId: "codex" },
  });

  it("sorts recent first, sinks unavailable chats, and labels the one Resume opens", () => {
    const rows = buildChatRows(binding, [
      { threadId: "gone-gone-gone", thread: null },
      { threadId: "other", thread: thread("2026-10-05T05:00:00Z", "/elsewhere", "task/one") },
      { threadId: "old", thread: thread("2026-10-05T01:00:00Z", binding.worktreePath, "task/one") },
      { threadId: "new", thread: thread("2026-10-05T03:00:00Z", binding.worktreePath, "task/one") },
      { threadId: "nobranch", thread: thread("2026-10-05T04:00:00Z", binding.worktreePath, null) },
    ]);
    expect(rows.map((row) => row.threadId)).toEqual([
      "other",
      "nobranch",
      "new",
      "old",
      "gone-gone-gone",
    ]);
    expect(rows.find((row) => row.isLatest)?.threadId).toBe("new");
    expect(rows[0]?.badge?.label).toBe("Other workspace");
    expect(rows[1]?.badge?.label).toBe("Branch unknown");
    expect(rows.at(-1)).toMatchObject({ available: false, badge: { label: "Unavailable" } });
  });

  it("labels the newest loaded chat for a task without a binding", () => {
    const rows = buildChatRows(null, [
      { threadId: "a", thread: thread("2026-10-05T01:00:00Z", null, null) },
      { threadId: "b", thread: thread("2026-10-05T02:00:00Z", "/x", "y") },
    ]);
    expect(rows[0]).toMatchObject({ threadId: "b", isLatest: true, provider: "codex" });
  });
});
