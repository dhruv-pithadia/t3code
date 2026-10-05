import type {
  FeatureTaskDelivery,
  FeatureTaskWorkspaceBinding,
  FeatureTaskWorkspaceResult,
} from "@yantrix/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyLinkedThreadWorkspace,
  describeFeatureTaskDelivery,
  describeFeatureTaskWorkspace,
  latestResumableTaskThread,
  launchBlockedByWorkspace,
  legacyFeatureTaskWorkspaceStrategy,
  describeFeatureTaskError,
  validateWorktreeAttachPath,
  workspaceBlocksLaunch,
} from "./featureTaskWorkspace.ts";

const binding: FeatureTaskWorkspaceBinding = {
  repoPath: "/repo",
  worktreePath: "/wt/task",
  branch: "task/one",
  createdAt: "2026-10-05T00:00:00.000Z",
};

const thread = (worktreePath: string | null, branch: string | null, updatedAt: string) => ({
  worktreePath,
  branch,
  updatedAt,
});

describe("linked conversation workspace comparison", () => {
  it("matches only the bound path and branch", () => {
    expect(classifyLinkedThreadWorkspace(binding, thread("/wt/task/", "task/one", "a"))).toBe(
      "matches",
    );
    expect(classifyLinkedThreadWorkspace(binding, thread("/wt/other", "task/one", "a"))).toBe(
      "different",
    );
    expect(classifyLinkedThreadWorkspace(binding, thread("/wt/task", "main", "a"))).toBe(
      "different",
    );
    expect(classifyLinkedThreadWorkspace(binding, thread(null, null, "a"))).toBe("different");
    // The branch is part of the task identity: an unknown branch is not a match.
    expect(classifyLinkedThreadWorkspace(binding, thread("/wt/task", null, "a"))).toBe(
      "unverified",
    );
    expect(classifyLinkedThreadWorkspace(binding, null)).toBe("unavailable");
    expect(classifyLinkedThreadWorkspace(null, thread("/x", "y", "a"))).toBe("unbound");
    expect(classifyLinkedThreadWorkspace(undefined, null)).toBe("unbound");
  });

  it("resumes the newest conversation in the task workspace, never a mismatched one", () => {
    const candidates = [
      { threadId: "a", thread: thread("/wt/other", "task/one", "2026-10-05T03:00:00Z") },
      { threadId: "b", thread: thread("/wt/task", "task/one", "2026-10-05T01:00:00Z") },
      { threadId: "c", thread: thread("/wt/task", "task/one", "2026-10-05T02:00:00Z") },
      { threadId: "d", thread: null },
      { threadId: "e", thread: thread("/wt/task", null, "2026-10-05T04:00:00Z") },
    ];
    expect(latestResumableTaskThread(binding, candidates)?.threadId).toBe("c");
    expect(latestResumableTaskThread(binding, candidates.slice(0, 1))).toBeNull();
    // Legacy tasks keep resuming the newest loaded conversation.
    expect(latestResumableTaskThread(null, candidates)?.threadId).toBe("e");
  });
});

describe("workspace recovery options", () => {
  const result = (
    state: FeatureTaskWorkspaceResult["state"],
    recoveryAvailable = false,
  ): FeatureTaskWorkspaceResult => ({ state, binding, recoveryAvailable });

  it("offers restore only when the server can recover without data loss", () => {
    expect(describeFeatureTaskWorkspace(result("missing", true)).actions).toContain("restore");
    expect(describeFeatureTaskWorkspace(result("missing", false)).actions).not.toContain("restore");
  });

  it("blocks launches only for states a person must repair", () => {
    expect(workspaceBlocksLaunch(result("ready"))).toBe(false);
    expect(workspaceBlocksLaunch(result("unbound"))).toBe(false);
    expect(workspaceBlocksLaunch(result("missing", true))).toBe(false);
    expect(workspaceBlocksLaunch(result("missing", false))).toBe(true);
    expect(workspaceBlocksLaunch(result("branch_mismatch", true))).toBe(true);
    expect(workspaceBlocksLaunch(result("conflict"))).toBe(true);
  });

  it("does not trust a stale ready report after the latest inspection failed", () => {
    expect(launchBlockedByWorkspace(result("ready"), false)).toBe(false);
    expect(launchBlockedByWorkspace(result("ready"), true)).toBe(true);
    expect(launchBlockedByWorkspace(null, true)).toBe(true);
    expect(launchBlockedByWorkspace(null, false)).toBe(false);
    expect(launchBlockedByWorkspace(result("conflict"), false)).toBe(true);
  });

  it("does not trust a prior ready report while the latest inspection is pending", () => {
    expect(launchBlockedByWorkspace(result("ready"), false, true)).toBe(true);
    expect(launchBlockedByWorkspace(null, false, true)).toBe(true);
    // Completing successfully unblocks; a completed broken report still blocks.
    expect(launchBlockedByWorkspace(result("ready"), false, false)).toBe(false);
    expect(launchBlockedByWorkspace(result("branch_mismatch"), false, false)).toBe(true);
  });

  it("never offers automatic repair for a branch mismatch or conflict", () => {
    for (const state of ["branch_mismatch", "conflict"] as const) {
      const actions = describeFeatureTaskWorkspace(result(state, true)).actions;
      expect(actions).not.toContain("restore");
      expect(actions).not.toContain("prepare");
    }
  });
});

describe("delivery description", () => {
  const delivery = (overrides: Partial<FeatureTaskDelivery>): FeatureTaskDelivery => ({
    pullRequest: {
      number: 12,
      title: "t",
      url: "https://example.test/12",
      state: "open",
      headBranch: "task/one",
      baseBranch: "main",
    },
    checks: "unknown",
    mergeState: "unknown",
    updatedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  });

  it("keeps unknown checks and merge state unknown", () => {
    const described = describeFeatureTaskDelivery(delivery({}));
    expect(described.tone).toBe("unknown");
    expect(described.checks?.label).toBe("Checks unknown");
    expect(described.merge?.label).toBe("Merge state unknown");
  });

  it("does not call an open pull request with passing checks merged", () => {
    const described = describeFeatureTaskDelivery(
      delivery({ checks: "passing", mergeState: "open" }),
    );
    expect(described.merge?.label).toBe("Not merged");
    expect(described.checks?.tone).toBe("success");
  });

  it("surfaces failing checks and merged pull requests distinctly", () => {
    expect(
      describeFeatureTaskDelivery(delivery({ checks: "failing", mergeState: "open" })).tone,
    ).toBe("danger");
    expect(
      describeFeatureTaskDelivery(delivery({ checks: "passing", mergeState: "merged" })).merge
        ?.label,
    ).toBe("Merged");
  });

  it("reports an unqueried delivery as unknown rather than as no pull request", () => {
    expect(
      describeFeatureTaskDelivery(delivery({ pullRequest: null, updatedAt: null })).headline,
    ).toBe("Delivery unknown");
    expect(
      describeFeatureTaskDelivery(delivery({ pullRequest: null, mergeState: "open" })).headline,
    ).toBe("No pull request");
  });
});

describe("legacy workspace strategy", () => {
  it("follows the latest conversation's checkout, then the fallback", () => {
    expect(legacyFeatureTaskWorkspaceStrategy({ worktreePath: "/wt/a", branch: "b" })).toEqual({
      type: "existing_worktree",
      worktreePath: "/wt/a",
      branch: "b",
    });
    expect(legacyFeatureTaskWorkspaceStrategy({ worktreePath: null, branch: "b" })).toEqual({
      type: "root",
      branch: "b",
    });
    expect(legacyFeatureTaskWorkspaceStrategy(null)).toEqual({ type: "root" });
    expect(legacyFeatureTaskWorkspaceStrategy(null, { type: "worktree", baseRef: "main" })).toEqual(
      { type: "worktree", baseRef: "main" },
    );
  });
});

describe("attach path validation", () => {
  it("rejects input that can never be a replacement worktree", () => {
    expect(validateWorktreeAttachPath("  ", binding)).not.toBeNull();
    expect(validateWorktreeAttachPath("relative/path", binding)).not.toBeNull();
    expect(validateWorktreeAttachPath("/repo/", binding)).toMatch(/main checkout/);
    expect(validateWorktreeAttachPath("/wt/task", binding)).toMatch(/already/);
    expect(validateWorktreeAttachPath("/wt/other", binding)).toBeNull();
    expect(validateWorktreeAttachPath("C:\\wt\\other", binding)).toBeNull();
  });
});

describe("error messages", () => {
  it("keeps the server's own wording, including from plain wire objects", () => {
    expect(describeFeatureTaskError(new Error("Worktree is dirty"))).toBe("Worktree is dirty");
    expect(
      describeFeatureTaskError({
        _tag: "FeatureTaskError",
        message: "Branch is checked out elsewhere",
      }),
    ).toBe("Branch is checked out elsewhere");
    expect(describeFeatureTaskError(undefined)).toMatch(/Try again/);
  });

  it("turns raw socket failures into a plain reconnect message but keeps real server messages", () => {
    const reconnect = /connection to this environment was interrupted/;
    expect(
      describeFeatureTaskError("SocketCloseError: 1011: Connection-loss verification"),
    ).toMatch(reconnect);
    expect(describeFeatureTaskError({ _tag: "SocketError", message: "boom" })).toMatch(reconnect);
    const closed = new Error("closed");
    closed.name = "SocketCloseError";
    expect(describeFeatureTaskError(closed)).toMatch(reconnect);
    expect(
      describeFeatureTaskError({
        _tag: "FeatureTaskError",
        code: "conflict",
        message: "Worktree is already owned by another task",
      }),
    ).toBe("Worktree is already owned by another task");
    expect(describeFeatureTaskError("Environment Laptop is not connected.")).toBe(
      "Environment Laptop is not connected.",
    );
  });
});
