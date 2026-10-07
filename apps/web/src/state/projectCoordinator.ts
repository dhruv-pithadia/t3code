import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectCoordinatorSnapshot, ProjectId } from "@yantrix/contracts";
import {
  createCoordinatorRequestLedger,
  sendCoordinatorText,
} from "@yantrix/client-runtime/state/project-coordinator";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { randomUUID } from "../lib/utils";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { formatEnvironmentQueryError } from "./query";
import { useAtomCommand } from "./use-atom-command";

type CoordinatorLiveResult =
  ReturnType<typeof serverEnvironment.coordinatorLive> extends Atom.Atom<infer Result>
    ? Result
    : never;

const NO_COORDINATOR_ATOM = Atom.make<CoordinatorLiveResult>(
  AsyncResult.initial() as CoordinatorLiveResult,
).pipe(Atom.withLabel("web-project-coordinator:none"));

/** Hosts that predate the coordinator do not advertise it, and every coordinator call is skipped for them. */
export function useProjectCoordinatorSupported(environmentId: EnvironmentId | null): boolean {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  return (
    environmentId !== null &&
    serverConfigs.get(environmentId)?.environment.capabilities.projectCoordinator === true
  );
}

export interface ProjectCoordinatorView {
  readonly supported: boolean;
  readonly snapshot: ProjectCoordinatorSnapshot | null;
  readonly error: string | null;
  readonly isPending: boolean;
}

/** Live coordinator state for a project. It never creates the coordinator thread. */
export function useProjectCoordinator(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ProjectCoordinatorView {
  const supported = useProjectCoordinatorSupported(environmentId);
  const atom = useMemo(
    () =>
      supported && environmentId !== null && projectId !== null
        ? serverEnvironment.coordinatorLive({ environmentId, input: { projectId } })
        : NO_COORDINATOR_ATOM,
    [environmentId, projectId, supported],
  );
  const result = useAtomValue(atom);
  return useMemo(
    () => ({
      supported,
      snapshot: Option.getOrNull(AsyncResult.value(result)),
      error: result._tag === "Failure" ? formatEnvironmentQueryError(result.cause) : null,
      isPending: result.waiting && Option.isNone(AsyncResult.value(result)),
    }),
    [result, supported],
  );
}

const ledgerStorage = (() => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
})();

/** One ledger per app so a retried message keeps its request id across views and reloads. */
const coordinatorRequestLedger = createCoordinatorRequestLedger({
  createId: () => `coordinator-request:${randomUUID()}`,
  storage: ledgerStorage,
});

const coordinatorScopeKey = (environmentId: EnvironmentId, projectId: ProjectId) =>
  `${environmentId}:${projectId}`;

/** Text-only send through the coordinator inbox. Raw text is persisted before any provider turn. */
export function useSendCoordinatorMessage() {
  const send = useAtomCommand(serverEnvironment.sendProjectCoordinator, {
    label: "send coordinator message",
    reportFailure: false,
  });
  return useCallback(
    (input: { environmentId: EnvironmentId; projectId: ProjectId; text: string }) =>
      sendCoordinatorText({
        ledger: coordinatorRequestLedger,
        scopeKey: coordinatorScopeKey(input.environmentId, input.projectId),
        projectId: input.projectId,
        text: input.text,
        send: async (request) => {
          const result = await send({ environmentId: input.environmentId, input: request });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          return result.value.snapshot;
        },
      }),
    [send],
  );
}

export function useObserveCoordinatorNotification() {
  return useAtomCommand(serverEnvironment.observeProjectCoordinatorNotification, {
    label: "acknowledge coordinator notification",
    reportFailure: false,
  });
}
