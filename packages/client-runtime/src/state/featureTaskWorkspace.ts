import type {
  FeatureTaskDelivery,
  FeatureTaskId,
  FeatureTaskWorkspaceBinding,
  FeatureTaskWorkspaceResult,
  FeatureTaskWorkspaceState,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
} from "@yantrix/contracts";

export interface FeatureTaskWorkspaceCommands {
  readonly inspectWorkspace: (input: {
    readonly id: FeatureTaskId;
  }) => Promise<FeatureTaskWorkspaceResult>;
  readonly ensureWorkspace: (input: {
    readonly id: FeatureTaskId;
  }) => Promise<FeatureTaskWorkspaceResult>;
}

export type FeatureTaskWorkspaceAction = "prepare" | "restore" | "attach" | "recheck";

/** Thrown when a launch must not proceed because the task workspace needs a person to repair it. */
export class FeatureTaskWorkspaceBlockedError extends Error {
  readonly state: FeatureTaskWorkspaceState;
  readonly result: FeatureTaskWorkspaceResult;

  constructor(result: FeatureTaskWorkspaceResult) {
    super(describeFeatureTaskWorkspace(result).detail);
    this.name = "FeatureTaskWorkspaceBlockedError";
    this.state = result.state;
    this.result = result;
  }
}

/** A task that owns a workspace was reached through a host that cannot verify it. */
export class FeatureTaskWorkspaceUnsupportedError extends Error {
  constructor(
    message = "This task has its own workspace, but this server cannot verify it. Update the server before starting work so the conversation does not run in the wrong checkout.",
  ) {
    super(message);
    this.name = "FeatureTaskWorkspaceUnsupportedError";
  }
}

/**
 * Original launch behavior for hosts without task workspaces: follow the most
 * recent linked conversation, or use the caller's fallback. Never used for a
 * task that owns a workspace.
 */
export function legacyFeatureTaskWorkspaceStrategy(
  latest: WorkspaceCarrier | null,
  fallback: OrchestrationV2ThreadLaunchWorkspaceStrategy = { type: "root" },
): OrchestrationV2ThreadLaunchWorkspaceStrategy {
  if (latest === null) return fallback;
  return latest.worktreePath
    ? {
        type: "existing_worktree",
        worktreePath: latest.worktreePath,
        ...(latest.branch ? { branch: latest.branch } : {}),
      }
    : { type: "root", ...(latest.branch ? { branch: latest.branch } : {}) };
}

/** Absolute path check that accepts POSIX, Windows drive, and UNC paths. */
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;

/**
 * Local checks before asking the server to adopt a different worktree. The
 * server remains the authority on repository and branch safety; this only
 * rejects input that can never be a valid replacement.
 */
export function validateWorktreeAttachPath(
  rawPath: string,
  binding: FeatureTaskWorkspaceBinding | null,
): string | null {
  const path = rawPath.trim();
  if (path.length === 0) return "Enter the absolute path of a worktree.";
  if (!ABSOLUTE_PATH.test(path))
    return "Use an absolute path, such as /Users/you/repo-worktrees/task.";
  if (binding) {
    if (normalizePath(path) === normalizePath(binding.repoPath)) {
      return "That is the main checkout of the repository. Choose a separate worktree so the task keeps its own branch.";
    }
    if (normalizePath(path) === normalizePath(binding.worktreePath)) {
      return "The task already points at that path. Use Check again after fixing it on disk.";
    }
  }
  return null;
}

const TRANSPORT_FAILURE = /\bSocket(?:Close)?Error\b|connection[- ]loss/iu;
const TRANSPORT_FAILURE_TAGS = new Set(["SocketError", "SocketCloseError"]);

/**
 * Server messages are shown as written, including conflicts and not-connected
 * notices that name an environment. Only raw socket transport failures, which
 * mean nothing to a person, become a plain reconnect message.
 */
export function describeFeatureTaskError(error: unknown): string {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? (error as { readonly _tag: unknown })._tag
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? (error as { readonly message: unknown }).message
          : undefined;
  const text = typeof message === "string" ? message.trim() : "";
  if (
    (typeof tag === "string" && TRANSPORT_FAILURE_TAGS.has(tag)) ||
    TRANSPORT_FAILURE.test(text) ||
    (error instanceof Error && TRANSPORT_FAILURE_TAGS.has(error.name))
  ) {
    return "The connection to this environment was interrupted. Reconnect and try again.";
  }
  return text.length > 0 ? text : "The request failed. Try again.";
}

/**
 * Returns the task's authoritative worktree binding, provisioning it when the
 * task has none. Only states the server can repair without touching existing
 * work are ensured; a branch mismatch or conflict stops the launch so no
 * conversation starts in the wrong checkout.
 */
export async function resolveFeatureTaskWorkspace(
  commands: FeatureTaskWorkspaceCommands,
  taskId: FeatureTaskId,
): Promise<FeatureTaskWorkspaceBinding> {
  const inspected = await commands.inspectWorkspace({ id: taskId });
  if (inspected.state === "ready" && inspected.binding !== null) return inspected.binding;

  const canProvision =
    inspected.state === "unbound" || (inspected.state === "missing" && inspected.recoveryAvailable);
  if (!canProvision) throw new FeatureTaskWorkspaceBlockedError(inspected);

  const ensured = await commands.ensureWorkspace({ id: taskId });
  if (ensured.state !== "ready" || ensured.binding === null) {
    throw new FeatureTaskWorkspaceBlockedError(ensured);
  }
  return ensured.binding;
}

/** True when starting or resuming work would have to fail until someone repairs the workspace. */
export function workspaceBlocksLaunch(result: FeatureTaskWorkspaceResult): boolean {
  return !(
    result.state === "ready" ||
    result.state === "unbound" ||
    (result.state === "missing" && result.recoveryAvailable)
  );
}

/**
 * Whether starting or resuming must wait on the workspace. Query data survives
 * a failed refresh, so a report from before a disconnect can still say "ready".
 * When the latest inspection failed the current health is unknown, which blocks
 * exactly like a broken workspace instead of trusting the stale report.
 */
export function launchBlockedByWorkspace(
  result: FeatureTaskWorkspaceResult | null,
  latestInspectionFailed: boolean,
  latestInspectionPending = false,
): boolean {
  // A reactive query that is waiting (for example on reconnection) keeps its
  // previous success, so a pending inspection is just as unknown as a failed one.
  if (latestInspectionFailed || latestInspectionPending) return true;
  return result !== null && workspaceBlocksLaunch(result);
}

/** Launch input that places a conversation in the task's own worktree and branch. */
export function workspaceStrategyForBinding(
  binding: FeatureTaskWorkspaceBinding,
): OrchestrationV2ThreadLaunchWorkspaceStrategy {
  return {
    type: "existing_worktree",
    worktreePath: binding.worktreePath,
    branch: binding.branch,
  };
}

const normalizePath = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/u, "") : path);

export type LinkedThreadWorkspaceMatch =
  /** Task has no binding, so there is nothing to compare against. */
  | "unbound"
  | "matches"
  | "different"
  /** The conversation is not loaded, so its checkout cannot be compared. */
  | "unavailable"
  /** Same path, but the conversation does not report a branch to confirm the task branch. */
  | "unverified";

export interface WorkspaceCarrier {
  readonly worktreePath: string | null;
  readonly branch: string | null;
}

/** Compares a linked conversation's checkout with the task binding without changing either. */
export function classifyLinkedThreadWorkspace(
  binding: FeatureTaskWorkspaceBinding | null | undefined,
  thread: WorkspaceCarrier | null,
): LinkedThreadWorkspaceMatch {
  if (!binding) return "unbound";
  if (thread === null) return "unavailable";
  if (thread.worktreePath === null) return "different";
  if (normalizePath(thread.worktreePath) !== normalizePath(binding.worktreePath))
    return "different";
  if (thread.branch === null) return "unverified";
  return thread.branch === binding.branch ? "matches" : "different";
}

export interface ResumableThreadCandidate<
  T extends WorkspaceCarrier & { readonly updatedAt: string },
> {
  readonly threadId: string;
  readonly thread: T | null;
}

/**
 * The conversation "Resume" should open. Legacy tasks take the most recent
 * loaded conversation. Bound tasks only resume conversations that live in the
 * task workspace; others stay reachable individually but are never picked.
 */
export function latestResumableTaskThread<
  T extends WorkspaceCarrier & { readonly updatedAt: string },
  C extends ResumableThreadCandidate<T>,
>(binding: FeatureTaskWorkspaceBinding | null | undefined, candidates: ReadonlyArray<C>): C | null {
  let latest: C | null = null;
  for (const candidate of candidates) {
    if (candidate.thread === null) continue;
    const match = classifyLinkedThreadWorkspace(binding, candidate.thread);
    if (match !== "matches" && match !== "unbound") continue;
    if (latest === null || candidate.thread.updatedAt > latest.thread!.updatedAt)
      latest = candidate;
  }
  return latest;
}

export type DeliveryTone = "neutral" | "pending" | "success" | "danger" | "unknown";

export interface WorkspaceDescription {
  readonly label: string;
  readonly tone: DeliveryTone;
  readonly detail: string;
  readonly actions: ReadonlyArray<FeatureTaskWorkspaceAction>;
}

/** Plain-language state and the repairs that are safe to offer for it. */
export function describeFeatureTaskWorkspace(
  result: FeatureTaskWorkspaceResult,
): WorkspaceDescription {
  const branch = result.binding?.branch;
  switch (result.state) {
    case "ready":
      return {
        label: "Ready",
        tone: "success",
        detail: branch
          ? `Work happens on ${branch} in its own worktree.`
          : "The task workspace is ready.",
        actions: ["recheck", "attach"],
      };
    case "unbound":
      return {
        label: "Not set up",
        tone: "neutral",
        detail:
          "A separate worktree and branch are created when work on this task starts. If its conversations already work in a separate worktree, use that one instead and nothing is moved.",
        actions: ["prepare", "attach"],
      };
    case "missing":
      return result.recoveryAvailable
        ? {
            label: "Folder missing",
            tone: "danger",
            detail: `The worktree folder is gone. Restoring recreates it${branch ? ` from ${branch}` : ""} and its saved commits. Uncommitted changes that were in the folder cannot be reconstructed.`,
            actions: ["restore", "attach", "recheck"],
          }
        : {
            label: "Folder missing",
            tone: "danger",
            detail:
              "The worktree folder is gone and cannot be restored automatically. Point the task at an existing worktree for the same repository.",
            actions: ["attach", "recheck"],
          };
    case "branch_mismatch":
      return {
        label: "Branch mismatch",
        tone: "danger",
        detail: `The worktree is not on ${branch ?? "the task branch"}. Nothing was changed. Switch the branch yourself, or use another worktree.`,
        actions: ["attach", "recheck"],
      };
    case "conflict":
      return {
        label: "Needs repair",
        tone: "danger",
        detail:
          "The worktree has a conflict that cannot be resolved safely here. Nothing was changed. Resolve it in the worktree, then check again.",
        actions: ["recheck", "attach"],
      };
  }
}

export interface DeliveryDescription {
  readonly headline: string;
  readonly tone: DeliveryTone;
  readonly checks: { readonly label: string; readonly tone: DeliveryTone } | null;
  readonly merge: { readonly label: string; readonly tone: DeliveryTone } | null;
}

/**
 * Delivery facts come only from the host's report. Unknown stays unknown and
 * is never inferred from the task's own progress status.
 */
export function describeFeatureTaskDelivery(delivery: FeatureTaskDelivery): DeliveryDescription {
  const checks =
    delivery.checks === "passing"
      ? { label: "Checks passing", tone: "success" as const }
      : delivery.checks === "failing"
        ? { label: "Checks failing", tone: "danger" as const }
        : delivery.checks === "pending"
          ? { label: "Checks running", tone: "pending" as const }
          : { label: "Checks unknown", tone: "unknown" as const };
  const merge =
    delivery.mergeState === "merged"
      ? { label: "Merged", tone: "success" as const }
      : delivery.mergeState === "closed"
        ? { label: "Closed without merging", tone: "danger" as const }
        : delivery.mergeState === "open"
          ? { label: "Not merged", tone: "neutral" as const }
          : { label: "Merge state unknown", tone: "unknown" as const };

  if (delivery.pullRequest === null) {
    return {
      headline: delivery.updatedAt === null ? "Delivery unknown" : "No pull request",
      tone: delivery.updatedAt === null ? "unknown" : "neutral",
      checks: null,
      merge: null,
    };
  }
  const tone =
    delivery.mergeState === "merged"
      ? "success"
      : delivery.mergeState === "closed" || delivery.checks === "failing"
        ? "danger"
        : delivery.checks === "pending"
          ? "pending"
          : delivery.mergeState === "unknown" || delivery.checks === "unknown"
            ? "unknown"
            : "success";
  return { headline: `Pull request #${delivery.pullRequest.number}`, tone, checks, merge };
}
