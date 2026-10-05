import * as Schema from "effect/Schema";
import type {
  FeatureTaskDelivery,
  FeatureTaskWorkspaceBinding,
  FeatureTaskWorkspaceResult,
} from "@yantrix/contracts";
import {
  classifyLinkedThreadWorkspace,
  describeFeatureTaskDelivery,
  describeFeatureTaskWorkspace,
  type DeliveryTone,
} from "@yantrix/client-runtime/state/feature-task-workspace";

export type TaskInspectorTab = "workspace" | "delivery" | "chats";

/** Viewport width at which the inspector docks beside the task instead of opening as a sheet. */
export const TASK_INSPECTOR_DOCK_MIN_WIDTH = 1180;

export const TASK_INSPECTOR_PREFERENCE_KEY = "yantrix:task-inspector:preference:v1";
/** "auto" means the user never chose; it follows the viewport. Only explicit choices are stored as open/closed. */
export const TaskInspectorPreference = Schema.Literals(["auto", "open", "closed"]);
export type TaskInspectorPreference = typeof TaskInspectorPreference.Type;

/** Docked visibility. A narrow viewport never docks, so a resize cannot rewrite the saved choice. */
export function resolveDockedInspectorOpen(
  preference: TaskInspectorPreference,
  canDock: boolean,
): boolean {
  return canDock && preference !== "closed";
}

/** Last path segment, for a short worktree name. Handles POSIX and Windows separators. */
export function worktreeBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const last = trimmed.split(/[\\/]/u).pop();
  return last && last.length > 0 ? last : path;
}

export interface InspectorHealth {
  readonly kind: "unsupported" | "checking" | "unavailable" | "stale" | "known";
  readonly label: string;
  readonly tone: DeliveryTone;
  /** Worth interrupting a glance: the user may need to repair something. */
  readonly needsAttention: boolean;
}

/**
 * What the workspace status may truthfully claim right now. Query data survives
 * a failed or waiting refresh, so a cached report is only current when the
 * latest inspection is neither pending nor failed.
 */
export function deriveWorkspaceHealth(input: {
  readonly supported: boolean;
  readonly binding: FeatureTaskWorkspaceBinding | null;
  readonly workspace: FeatureTaskWorkspaceResult | null;
  readonly error: string | null;
  readonly isPending: boolean;
}): InspectorHealth {
  if (!input.supported) {
    return input.binding
      ? {
          kind: "unsupported",
          label: "Can't verify workspace",
          tone: "danger",
          needsAttention: true,
        }
      : { kind: "unsupported", label: "Project workspace", tone: "neutral", needsAttention: false };
  }
  const known = input.workspace ? describeFeatureTaskWorkspace(input.workspace) : null;
  if (input.error !== null) {
    return known
      ? {
          kind: "stale",
          label: `Last known: ${known.label}`,
          tone: "unknown",
          needsAttention: true,
        }
      : {
          kind: "unavailable",
          label: "Workspace unavailable",
          tone: "unknown",
          needsAttention: true,
        };
  }
  if (input.isPending || known === null) {
    return {
      kind: "checking",
      label: "Checking workspace",
      tone: "neutral",
      needsAttention: false,
    };
  }
  return {
    kind: "known",
    label: known.label,
    tone: known.tone,
    needsAttention: known.tone === "danger",
  };
}

export interface DeliverySummary {
  readonly label: string;
  readonly tone: DeliveryTone;
  /** True when the facts are from before a failed or still-running refresh. */
  readonly stale: boolean;
  /** A refresh is in flight with earlier facts still on screen. */
  readonly checking: boolean;
}

function describeDeliveryFacts(delivery: FeatureTaskDelivery): {
  label: string;
  tone: DeliveryTone;
} {
  const described = describeFeatureTaskDelivery(delivery);
  if (delivery.pullRequest === null) return { label: described.headline, tone: described.tone };
  const detail =
    delivery.mergeState === "merged" || delivery.mergeState === "closed"
      ? described.merge?.label
      : described.checks?.label;
  return {
    label: `PR #${delivery.pullRequest.number}${detail ? ` · ${detail}` : ""}`,
    tone: described.tone,
  };
}

export function deriveDeliverySummary(input: {
  readonly hasWorkspace: boolean;
  readonly delivery: FeatureTaskDelivery | null;
  readonly error: string | null;
  readonly isPending: boolean;
}): DeliverySummary {
  if (!input.hasWorkspace) {
    return { label: "Not set up", tone: "neutral", stale: false, checking: false };
  }
  if (input.delivery === null) {
    return input.error !== null
      ? { label: "Delivery unavailable", tone: "unknown", stale: false, checking: false }
      : { label: "Checking delivery", tone: "neutral", stale: false, checking: true };
  }
  // Query data survives a failed or waiting refresh, so cached facts are only current when neither applies.
  const facts = describeDeliveryFacts(input.delivery);
  return input.error !== null || input.isPending
    ? {
        label: `Last known: ${facts.label}`,
        tone: "unknown",
        stale: true,
        checking: input.error === null,
      }
    : { ...facts, stale: false, checking: false };
}

export interface ChatRowInput {
  readonly threadId: string;
  readonly thread: {
    readonly title: string;
    readonly updatedAt: string;
    readonly worktreePath: string | null;
    readonly branch: string | null;
    readonly modelSelection?: { readonly instanceId: string } | null;
  } | null;
}

export interface ChatRow {
  readonly threadId: string;
  readonly title: string;
  readonly updatedAt: string | null;
  readonly provider: string | null;
  readonly available: boolean;
  /** The conversation Resume would open. */
  readonly isLatest: boolean;
  readonly badge: { readonly label: string; readonly tone: DeliveryTone } | null;
}

/** Recent first; conversations that cannot be loaded sink to the end. */
export function buildChatRows(
  binding: FeatureTaskWorkspaceBinding | null | undefined,
  linked: ReadonlyArray<ChatRowInput>,
): ReadonlyArray<ChatRow> {
  const rows = linked.map((entry): ChatRow => {
    if (entry.thread === null) {
      return {
        threadId: entry.threadId,
        title: `Conversation ${entry.threadId.slice(0, 8)}`,
        updatedAt: null,
        provider: null,
        available: false,
        isLatest: false,
        badge: { label: "Unavailable", tone: "unknown" },
      };
    }
    const match = classifyLinkedThreadWorkspace(binding, entry.thread);
    return {
      threadId: entry.threadId,
      title: entry.thread.title || "Untitled conversation",
      updatedAt: entry.thread.updatedAt,
      provider: entry.thread.modelSelection?.instanceId ?? null,
      available: true,
      isLatest: false,
      badge:
        match === "different"
          ? { label: "Other workspace", tone: "pending" }
          : match === "unverified"
            ? { label: "Branch unknown", tone: "unknown" }
            : null,
    };
  });
  rows.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
  const latestIndex = rows.findIndex((row) => row.available && row.badge === null);
  return rows.map((row, index) => (index === latestIndex ? { ...row, isLatest: true } : row));
}
