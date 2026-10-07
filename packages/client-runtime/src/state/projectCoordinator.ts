import type {
  ProjectCoordinatorNotification,
  ProjectCoordinatorRequest,
  ProjectCoordinatorSnapshot,
  ThreadId,
} from "@yantrix/contracts";

/**
 * Shared coordinator behavior for web and mobile: the stable request ledger,
 * the text-only send flow, and the wording for request routes. Rendering stays
 * in each client.
 */

/** Storage may be synchronous (web localStorage) or asynchronous (mobile files). */
export interface CoordinatorLedgerStorage {
  readonly getItem: (key: string) => string | null | Promise<string | null>;
  readonly setItem: (key: string, value: string) => void | Promise<void>;
  readonly removeItem: (key: string) => void | Promise<void>;
}

interface LedgerEntry {
  readonly requestId: string;
  readonly text: string;
}

const LEDGER_KEY_PREFIX = "yantrix:coordinator-requests:";
/** Unconfirmed requests kept per project. Past this, new text is refused rather than evicting a known id. */
export const MAX_LEDGER_ENTRIES = 20;

/** The ledger could not read or persist ids, so sending now could duplicate a message later. */
export class CoordinatorLedgerError extends Error {
  override readonly name = "CoordinatorLedgerError";
  readonly reason: "read" | "write" | "capacity";
  constructor(
    message: string,
    reason: "read" | "write" | "capacity",
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.reason = reason;
  }
}

/**
 * A missing key is an empty ledger. A storage failure throws, because treating
 * it as empty would forget ids the server may already hold. Entries that are
 * not well-formed carry no recoverable id and are dropped.
 */
async function readEntries(
  storage: CoordinatorLedgerStorage | null,
  key: string,
): Promise<LedgerEntry[]> {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = await storage.getItem(LEDGER_KEY_PREFIX + key);
  } catch (cause) {
    throw new CoordinatorLedgerError(
      "Could not read saved message state on this device. Try again.",
      "read",
      { cause },
    );
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (entry): entry is LedgerEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as LedgerEntry).requestId === "string" &&
      typeof (entry as LedgerEntry).text === "string",
  );
}

async function writeEntries(
  storage: CoordinatorLedgerStorage | null,
  key: string,
  entries: ReadonlyArray<LedgerEntry>,
) {
  if (storage === null) return;
  try {
    if (entries.length === 0) await storage.removeItem(LEDGER_KEY_PREFIX + key);
    else await storage.setItem(LEDGER_KEY_PREFIX + key, JSON.stringify(entries));
  } catch (cause) {
    throw new CoordinatorLedgerError(
      "Could not save the message on this device. Try again.",
      "write",
      { cause },
    );
  }
}

/**
 * Remembers the request id for every text that was submitted but not yet
 * confirmed. A retry of the same text, after an error, a dropped connection, a
 * reload or an app restart, reuses the id instead of minting a new one, so the
 * server never sees one message as two requests. Ids are released only once
 * the server has accepted the request.
 *
 * Memory mirrors what storage holds: an id enters `memory` only after it is
 * persisted, and `claim` rejects when storage cannot be read or written, so no
 * request leaves the device with an id that a restart could forget. Unconfirmed
 * ids are never evicted; at capacity `claim` rejects for new text instead.
 */
export function createCoordinatorRequestLedger(options: {
  readonly createId: () => string;
  readonly storage?: CoordinatorLedgerStorage | null;
}) {
  const storage = options.storage ?? null;
  const memory = new Map<string, ReadonlyArray<LedgerEntry>>();
  const queues = new Map<string, Promise<unknown>>();

  /** One operation at a time per scope, so a load never races a write. */
  const serialize = <T>(scopeKey: string, operation: () => Promise<T>): Promise<T> => {
    const run = (queues.get(scopeKey) ?? Promise.resolve()).then(operation);
    queues.set(
      scopeKey,
      run.catch(() => undefined),
    );
    return run;
  };

  /** A failed read is not cached, so the next call reads storage again. */
  const load = async (scopeKey: string) => {
    const existing = memory.get(scopeKey);
    if (existing) return existing;
    const loaded = await readEntries(storage, scopeKey);
    memory.set(scopeKey, loaded);
    return loaded;
  };

  const commit = async (scopeKey: string, next: ReadonlyArray<LedgerEntry>) => {
    await writeEntries(storage, scopeKey, next);
    memory.set(scopeKey, next);
  };

  return {
    /** The id to send `text` with: the earlier unconfirmed id for this text, or a fresh one. */
    claim: (scopeKey: string, text: string): Promise<string> =>
      serialize(scopeKey, async () => {
        const entries = await load(scopeKey);
        const known = entries.find((entry) => entry.text === text);
        if (known) return known.requestId;
        if (entries.length >= MAX_LEDGER_ENTRIES) {
          throw new CoordinatorLedgerError(
            "Too many earlier messages are still waiting to be confirmed. Retry one of them first.",
            "capacity",
          );
        }
        const entry = { requestId: options.createId(), text };
        await commit(scopeKey, [...entries, entry]);
        return entry.requestId;
      }),
    /** Rejects when the removal is not persisted; the id then stays, and replaying it is safe. */
    release: (scopeKey: string, requestId: string): Promise<void> =>
      serialize(scopeKey, async () => {
        const entries = await load(scopeKey);
        if (!entries.some((entry) => entry.requestId === requestId)) return;
        await commit(
          scopeKey,
          entries.filter((entry) => entry.requestId !== requestId),
        );
      }),
  };
}

export type CoordinatorRequestLedger = ReturnType<typeof createCoordinatorRequestLedger>;

export type CoordinatorSendOutcome =
  | {
      readonly status: "sent";
      readonly requestId: string;
      readonly snapshot: ProjectCoordinatorSnapshot;
    }
  | {
      readonly status: "failed";
      /** Null when the ledger could not issue an id, so nothing was sent. */
      readonly requestId: string | null;
      readonly error: unknown;
    }
  | { readonly status: "empty" }
  | { readonly status: "busy"; readonly requestId: string };

const inFlight = new Set<string>();

/**
 * Sends raw user text through the coordinator inbox. The request id is claimed
 * and persisted before the call and kept on failure, so the caller can restore
 * the draft and retry the identical request. A ledger failure blocks the send.
 * A release failure after the server accepted the request still reports "sent":
 * the id stays stored and a later replay of it is idempotent. Only one send per
 * project and text runs at a time.
 */
export async function sendCoordinatorText(input: {
  readonly ledger: CoordinatorRequestLedger;
  readonly scopeKey: string;
  readonly projectId: ProjectCoordinatorSnapshot["projectId"];
  readonly text: string;
  readonly send: (request: {
    readonly projectId: ProjectCoordinatorSnapshot["projectId"];
    readonly requestId: string;
    readonly text: string;
  }) => Promise<ProjectCoordinatorSnapshot>;
}): Promise<CoordinatorSendOutcome> {
  // The wording is stored exactly as typed; trimming is only used to spot an empty draft.
  const text = input.text;
  if (text.trim().length === 0) return { status: "empty" };
  let requestId: string;
  try {
    requestId = await input.ledger.claim(input.scopeKey, text);
  } catch (error) {
    return { status: "failed", requestId: null, error };
  }
  const flightKey = `${input.scopeKey}\n${requestId}`;
  if (inFlight.has(flightKey)) return { status: "busy", requestId };
  inFlight.add(flightKey);
  try {
    const snapshot = await input.send({ projectId: input.projectId, requestId, text });
    // Best effort: the server already has the request, and the retained id replays safely.
    await input.ledger.release(input.scopeKey, requestId).catch(() => undefined);
    return { status: "sent", requestId, snapshot };
  } catch (error) {
    return { status: "failed", requestId, error };
  } finally {
    inFlight.delete(flightKey);
  }
}

export interface CoordinatorRequestPresentation {
  readonly label: string;
  readonly detail: string | null;
  readonly tone: "neutral" | "progress" | "success" | "warning";
  /** True while the request is still being worked out or handed off. */
  readonly active: boolean;
}

/**
 * Wording for a request's durable route. It states only what the server has
 * recorded: "dispatched" means the worker thread was created and the task
 * message launched, never that the work is finished.
 */
export function describeCoordinatorRequest(
  request: Pick<ProjectCoordinatorRequest, "status" | "route" | "error">,
): CoordinatorRequestPresentation {
  switch (request.status) {
    case "pending":
      return {
        label: "Received",
        detail: "Saved. The coordinator has not decided how to handle it yet.",
        tone: "neutral",
        active: true,
      };
    case "discussed":
      return {
        label: "Discussed",
        detail: "Answered in the conversation. No work was started.",
        tone: "neutral",
        active: false,
      };
    case "dispatching":
      return {
        label: "Starting work",
        detail:
          request.route === "follow_up"
            ? "Passing this to the existing task. It has not been delivered yet."
            : "Preparing a worker. It has not started yet.",
        tone: "progress",
        active: true,
      };
    case "dispatched":
      return {
        label: request.route === "follow_up" ? "Sent to task" : "Worker started",
        detail:
          request.route === "follow_up"
            ? "Delivered to the existing task's worker."
            : "A separate worker is running this request.",
        tone: "success",
        active: false,
      };
    case "blocked":
      return {
        label: "Blocked",
        detail: request.error?.trim() || "The request could not be handed off.",
        tone: "warning",
        active: false,
      };
  }
}

/** Waiting items stay open until a user message resolves them, so seeing one does not clear it. */
const isWaitingKind = (kind: ProjectCoordinatorNotification["kind"]) =>
  kind === "worker_waiting" || kind === "pending_decision";

export interface CoordinatorAttention {
  /** Unresolved notifications. */
  readonly openNotifications: ReadonlyArray<ProjectCoordinatorNotification>;
  readonly blockedRequests: ReadonlyArray<ProjectCoordinatorRequest>;
  readonly activeRequests: ReadonlyArray<ProjectCoordinatorRequest>;
  /** Items that need the user, not merely in-flight work. */
  readonly attentionCount: number;
}

export function deriveCoordinatorAttention(
  snapshot: ProjectCoordinatorSnapshot | null,
): CoordinatorAttention {
  if (snapshot === null) {
    return {
      openNotifications: [],
      blockedRequests: [],
      activeRequests: [],
      attentionCount: 0,
    };
  }
  const openNotifications = snapshot.notifications.filter(
    (notification) => notification.status === "pending",
  );
  const needsUser = openNotifications.filter(
    (notification) => notification.observedAt === null || isWaitingKind(notification.kind),
  );
  const blockedRequests = snapshot.requests.filter((request) => request.status === "blocked");
  const activeRequests = snapshot.requests.filter(
    (request) => describeCoordinatorRequest(request).active,
  );
  return {
    openNotifications,
    blockedRequests,
    activeRequests,
    attentionCount: needsUser.length + blockedRequests.length,
  };
}

/** Requests newest first; the server numbers them in arrival order. */
export function sortCoordinatorRequests(
  requests: ReadonlyArray<ProjectCoordinatorRequest>,
): ReadonlyArray<ProjectCoordinatorRequest> {
  return [...requests].sort((a, b) => b.sequence - a.sequence);
}

export function isCoordinatorThread(
  snapshot: Pick<ProjectCoordinatorSnapshot, "threadId"> | null,
  threadId: ThreadId | null,
): boolean {
  return snapshot !== null && threadId !== null && snapshot.threadId === threadId;
}

export const COORDINATOR_TEXT_ONLY_MESSAGE =
  "The coordinator takes text only for now. Remove attachments and context to send.";

export const COORDINATOR_REQUIRES_CODEX_MESSAGE =
  "The coordinator needs Codex. Set up Codex in Settings to use it.";

/** A failure as a sentence for the user, without the error class prefix. */
export function describeCoordinatorError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return "Something went wrong. Try again.";
}

export function notificationKindLabel(kind: ProjectCoordinatorNotification["kind"]): string {
  switch (kind) {
    case "worker_completed":
      return "Worker finished";
    case "worker_failed":
      return "Worker failed";
    case "dispatch_blocked":
      return "Hand-off blocked";
    case "worker_waiting":
      return "Worker waiting for input";
    case "pending_decision":
      return "Decision needed";
  }
}
