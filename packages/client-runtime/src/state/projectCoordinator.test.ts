import {
  FeatureTaskId,
  MessageId,
  ProjectId,
  ThreadId,
  type ProjectCoordinatorRequest,
  type ProjectCoordinatorSnapshot,
} from "@yantrix/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  createCoordinatorRequestLedger,
  CoordinatorLedgerError,
  MAX_LEDGER_ENTRIES,
  deriveCoordinatorAttention,
  describeCoordinatorRequest,
  sendCoordinatorText,
  type CoordinatorLedgerStorage,
} from "./projectCoordinator.ts";

const projectId = ProjectId.make("project:one");

function memoryStorage(): CoordinatorLedgerStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function counterIds() {
  let next = 0;
  return () => `request-${++next}`;
}

function snapshot(overrides: Partial<ProjectCoordinatorSnapshot> = {}): ProjectCoordinatorSnapshot {
  return {
    projectId,
    threadId: ThreadId.make("thread:coordinator"),
    modelSelection: null,
    contextRevision: 0,
    decisions: [],
    requests: [],
    notifications: [],
    ...overrides,
  };
}

const notificationDefaults = {
  taskId: FeatureTaskId.make("feature-task:one"),
  workerThreadId: null,
  sourceMessageId: null,
  runtimeRequestId: null,
  status: "pending" as const,
  observedAt: null,
  resolvedAt: null,
  resolutionMessageId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function request(overrides: Partial<ProjectCoordinatorRequest> = {}): ProjectCoordinatorRequest {
  return {
    id: "request-1",
    projectId,
    sequence: 1,
    sourceMessageId: MessageId.make("message:one"),
    text: "Add export",
    status: "pending",
    route: null,
    taskId: null,
    workerThreadId: null,
    commandId: null,
    routePayload: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("coordinator request ledger", () => {
  it("reuses the id for the same text until the request is released", async () => {
    const ledger = createCoordinatorRequestLedger({ createId: counterIds() });
    const first = await ledger.claim("env:project", "Add export");
    expect(await ledger.claim("env:project", "Add export")).toBe(first);
    expect(await ledger.claim("env:project", "Something else")).not.toBe(first);
    await ledger.release("env:project", first);
    expect(await ledger.claim("env:project", "Add export")).not.toBe(first);
  });

  it("survives a reload through storage", async () => {
    const storage = memoryStorage();
    const before = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    const id = await before.claim("env:project", "Add export");
    const after = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    expect(await after.claim("env:project", "Add export")).toBe(id);
  });

  it("survives a restart through asynchronous storage and forgets released ids", async () => {
    const data = new Map<string, string>();
    const storage: CoordinatorLedgerStorage = {
      getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => void data.set(key, value),
      removeItem: async (key) => void data.delete(key),
    };
    const before = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    const id = await before.claim("env:project", "Add export");
    // The id is on disk by the time claim resolves, before any request is sent.
    expect(data.size).toBe(1);

    const after = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    expect(await after.claim("env:project", "Add export")).toBe(id);
    await after.release("env:project", id);
    expect(data.size).toBe(0);
    const restarted = createCoordinatorRequestLedger({ createId: () => "fresh-id", storage });
    expect(await restarted.claim("env:project", "Add export")).not.toBe(id);
  });

  it("hands one id to concurrent claims of the same text while storage is still loading", async () => {
    const storage: CoordinatorLedgerStorage = {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    };
    const ledger = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    const [a, b] = await Promise.all([
      ledger.claim("env:project", "Add export"),
      ledger.claim("env:project", "Add export"),
    ]);
    expect(a).toBe(b);
  });

  it("scopes ids per project", async () => {
    const ledger = createCoordinatorRequestLedger({ createId: counterIds() });
    expect(await ledger.claim("env:a", "Add export")).not.toBe(
      await ledger.claim("env:b", "Add export"),
    );
  });
});

describe("sendCoordinatorText", () => {
  it("keeps the same request id across a failed attempt and its retry", async () => {
    const ledger = createCoordinatorRequestLedger({ createId: counterIds() });
    const seen: string[] = [];
    const attempt = (fail: boolean) =>
      sendCoordinatorText({
        ledger,
        scopeKey: "env:project",
        projectId,
        text: "  Add export  \n",
        send: async (input) => {
          seen.push(input.requestId);
          // The wording reaches the inbox exactly as typed.
          expect(input.text).toBe("  Add export  \n");
          if (fail) throw new Error("socket closed");
          return snapshot();
        },
      });

    const failed = await attempt(true);
    expect(failed.status).toBe("failed");
    const retried = await attempt(false);
    expect(retried.status).toBe("sent");
    expect(seen[0]).toBe(seen[1]);

    await attempt(false);
    expect(seen[2]).not.toBe(seen[0]);
  });

  it("does not send empty text", async () => {
    const ledger = createCoordinatorRequestLedger({ createId: counterIds() });
    const outcome = await sendCoordinatorText({
      ledger,
      scopeKey: "env:project",
      projectId,
      text: "   ",
      send: async () => snapshot(),
    });
    expect(outcome.status).toBe("empty");
    expect(await ledger.claim("env:project", "x")).toBe("request-1");
  });

  it("refuses a concurrent duplicate of the same request", async () => {
    const ledger = createCoordinatorRequestLedger({ createId: counterIds() });
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = () =>
      sendCoordinatorText({
        ledger,
        scopeKey: "env:project",
        projectId,
        text: "Add export",
        send: async () => {
          await gate;
          return snapshot();
        },
      });
    const first = run();
    const second = await run();
    expect(second.status).toBe("busy");
    release();
    expect((await first).status).toBe("sent");
  });
});

describe("coordinator ledger storage failures", () => {
  const sendOnce = (ledger: ReturnType<typeof createCoordinatorRequestLedger>, text: string) => {
    const sent: string[] = [];
    const run = () =>
      sendCoordinatorText({
        ledger,
        scopeKey: "env:project",
        projectId,
        text,
        send: async (request) => {
          sent.push(request.requestId);
          return snapshot();
        },
      });
    return { sent, run };
  };

  it("blocks the send when storage cannot be read, then recovers on retry", async () => {
    const storage = memoryStorage();
    storage.data.set(
      "yantrix:coordinator-requests:env:project",
      JSON.stringify([{ requestId: "earlier", text: "Add export" }]),
    );
    let failReads = true;
    const flaky: CoordinatorLedgerStorage = {
      ...storage,
      getItem: (key) => {
        if (failReads) throw new Error("disk unavailable");
        return storage.getItem(key);
      },
    };
    const { sent, run } = sendOnce(
      createCoordinatorRequestLedger({ createId: counterIds(), storage: flaky }),
      "Add export",
    );

    const blocked = await run();
    expect(blocked).toMatchObject({ status: "failed", requestId: null });
    expect(blocked.status === "failed" && blocked.error).toBeInstanceOf(CoordinatorLedgerError);
    expect(sent).toEqual([]);

    failReads = false;
    expect((await run()).status).toBe("sent");
    // The stored id was not forgotten by the failed read.
    expect(sent).toEqual(["earlier"]);
  });

  it("blocks the send when the id cannot be persisted and keeps no unsaved id", async () => {
    const storage = memoryStorage();
    let failWrites = true;
    const flaky: CoordinatorLedgerStorage = {
      ...storage,
      setItem: (key, value) => {
        if (failWrites) throw new Error("quota exceeded");
        storage.setItem(key, value);
      },
    };
    const ids = counterIds();
    const ledger = createCoordinatorRequestLedger({ createId: ids, storage: flaky });
    const { sent, run } = sendOnce(ledger, "Add export");

    expect(await run()).toMatchObject({ status: "failed", requestId: null });
    expect(sent).toEqual([]);
    expect(storage.data.size).toBe(0);

    failWrites = false;
    expect((await run()).status).toBe("sent");
    // Retry minted and persisted a fresh id before sending, rather than trusting an unsaved one.
    expect(sent).toEqual(["request-2"]);
  });

  it("refuses new text at capacity without evicting an unconfirmed id", async () => {
    const storage = memoryStorage();
    const ledger = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    const first = await ledger.claim("env:project", "message 0");
    for (let index = 1; index < MAX_LEDGER_ENTRIES; index++) {
      await ledger.claim("env:project", `message ${index}`);
    }
    await expect(ledger.claim("env:project", "one too many")).rejects.toMatchObject({
      reason: "capacity",
    });
    // The oldest id is still known, in memory and after a restart.
    expect(await ledger.claim("env:project", "message 0")).toBe(first);
    const restarted = createCoordinatorRequestLedger({ createId: counterIds(), storage });
    expect(await restarted.claim("env:project", "message 0")).toBe(first);

    await ledger.release("env:project", first);
    await expect(ledger.claim("env:project", "one too many")).resolves.toBeTypeOf("string");
  });

  it("still reports sent when the release is not persisted, and replays the retained id", async () => {
    const storage = memoryStorage();
    let failRemoval = true;
    const flaky: CoordinatorLedgerStorage = {
      ...storage,
      setItem: (key, value) => {
        if (failRemoval && JSON.parse(value).length === 0) throw new Error("disk full");
        storage.setItem(key, value);
      },
      removeItem: (key) => {
        if (failRemoval) throw new Error("disk full");
        storage.removeItem(key);
      },
    };
    const ledger = createCoordinatorRequestLedger({ createId: counterIds(), storage: flaky });
    const { sent, run } = sendOnce(ledger, "Add export");

    const outcome = await run();
    expect(outcome).toMatchObject({ status: "sent", requestId: "request-1" });
    expect(storage.data.size).toBe(1);

    // Resending the same text replays the retained id, which the server answers idempotently.
    failRemoval = false;
    await run();
    expect(sent).toEqual(["request-1", "request-1"]);
    expect(storage.data.size).toBe(0);
  });
});

describe("request presentation", () => {
  it("does not call a dispatching request started", () => {
    const text = describeCoordinatorRequest({
      status: "dispatching",
      route: "new_task",
      error: null,
    });
    expect(text.label).toBe("Starting work");
    expect(text.active).toBe(true);
  });

  it("surfaces the blocked error", () => {
    const text = describeCoordinatorRequest({
      status: "blocked",
      route: "new_task",
      error: "Workspace is missing",
    });
    expect(text.tone).toBe("warning");
    expect(text.detail).toBe("Workspace is missing");
  });

  it("counts unobserved notifications and blocked requests as attention", () => {
    const attention = deriveCoordinatorAttention(
      snapshot({
        requests: [
          request({ id: "a", status: "blocked", error: "x" }),
          request({ id: "b", status: "dispatching", route: "new_task" }),
          request({ id: "c", status: "dispatched", route: "new_task" }),
        ],
        notifications: [
          {
            id: "n1",
            ...notificationDefaults,
            kind: "worker_completed",
            summary: "Done",
            observedAt: null,
          },
          {
            id: "n2",
            ...notificationDefaults,
            kind: "worker_failed",
            summary: "Failed",
            observedAt: "2026-01-01T00:01:00.000Z",
          },
          {
            id: "n3",
            ...notificationDefaults,
            kind: "worker_waiting",
            summary: "Needs approval",
            observedAt: "2026-01-01T00:01:00.000Z",
          },
          {
            id: "n4",
            ...notificationDefaults,
            kind: "worker_completed",
            summary: "Old",
            status: "resolved",
          },
        ],
      }),
    );
    // Unseen n1, waiting n3 (seen but unresolved) and blocked request "a"; seen n2 and resolved n4 do not count.
    expect(attention.attentionCount).toBe(3);
    expect(attention.openNotifications.map((entry) => entry.id)).toEqual(["n1", "n2", "n3"]);
    expect(attention.activeRequests.map((entry) => entry.id)).toEqual(["b"]);
  });
});
