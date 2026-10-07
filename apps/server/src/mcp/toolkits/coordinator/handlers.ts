import { OrchestratorMcpFailure } from "@yantrix/contracts";
import * as Effect from "effect/Effect";

import * as Coordinator from "../../../project/ProjectCoordinatorService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ProjectCoordinatorToolkit } from "./tools.ts";

const unavailable = (cause: { readonly message: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: cause.message });

const invoke = Effect.fn("mcp.coordinator.invoke")(function* (
  action: Parameters<Coordinator.ProjectCoordinatorService["Service"]["invoke"]>[0]["action"],
) {
  const scope = yield* McpInvocationContext.requireMcpCapability("orchestration").pipe(
    Effect.mapError(unavailable),
  );
  const service = yield* Coordinator.ProjectCoordinatorService;
  return yield* service
    .invoke({ callerThreadId: scope.threadId, action })
    .pipe(Effect.mapError(unavailable));
});

export const ProjectCoordinatorHandlersLive = ProjectCoordinatorToolkit.toLayer({
  yantrix_coordinator_read: (input) => invoke({ kind: "read", input }),
  yantrix_coordinator_route: (input) => invoke({ kind: "route", input }),
  yantrix_coordinator_record_decision: (input) => invoke({ kind: "decision", input }),
  yantrix_coordinator_ask: (input) => invoke({ kind: "ask", input }),
  yantrix_coordinator_resolve: (input) => invoke({ kind: "resolve", input }),
  yantrix_coordinator_observe_notification: (input) => invoke({ kind: "observe", input }),
});
