import { useAtomValue } from "@effect/atom-react";
import {
  createCoordinatorRequestLedger,
  isCoordinatorThread,
  sendCoordinatorText,
} from "@yantrix/client-runtime/state/project-coordinator";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectCoordinatorSnapshot,
  ProjectId,
  ThreadId,
} from "@yantrix/contracts";
import type { EnvironmentProject } from "@yantrix/client-runtime/state/shell";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { coordinatorRequestFileStorage } from "./coordinator-request-storage";
import { uuidv4 } from "../lib/uuid";
import { useProjects } from "./entities";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

type CoordinatorLiveResult =
  ReturnType<typeof serverEnvironment.coordinatorLive> extends Atom.Atom<infer Result>
    ? Result
    : never;

const NO_COORDINATOR_ATOM = Atom.make<CoordinatorLiveResult>(
  AsyncResult.initial() as CoordinatorLiveResult,
).pipe(Atom.withLabel("mobile-project-coordinator:none"));

/** Hosts that predate the coordinator do not advertise it. */
export function useProjectCoordinatorSupported(environmentId: EnvironmentId | null): boolean {
  const configs = useAtomValue(environmentServerConfigsAtom);
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.projectCoordinator === true
  );
}

/** Projects on hosts that offer a coordinator, in the order the project list gives them. */
export function useCoordinatorProjects(): ReadonlyArray<EnvironmentProject> {
  const projects = useProjects();
  const configs = useAtomValue(environmentServerConfigsAtom);
  return useMemo(
    () =>
      projects.filter(
        (project) =>
          configs.get(project.environmentId)?.environment.capabilities.projectCoordinator === true,
      ),
    [configs, projects],
  );
}

/** Live coordinator state for a project. It never creates the coordinator thread. */
export function useProjectCoordinator(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): ProjectCoordinatorSnapshot | null {
  const supported = useProjectCoordinatorSupported(environmentId);
  const atom = useMemo(
    () =>
      supported && environmentId !== null && projectId !== null
        ? serverEnvironment.coordinatorLive({ environmentId, input: { projectId } })
        : NO_COORDINATOR_ATOM,
    [environmentId, projectId, supported],
  );
  return Option.getOrNull(AsyncResult.value(useAtomValue(atom)));
}

/** The snapshot when `threadId` is that project's coordinator conversation, else null. */
export function useCoordinatorForThread(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  threadId: ThreadId | null,
): ProjectCoordinatorSnapshot | null {
  const snapshot = useProjectCoordinator(environmentId, projectId);
  return isCoordinatorThread(snapshot, threadId) ? snapshot : null;
}

/** One ledger per app, so a retried message keeps its request id across restarts. */
const requestLedger = createCoordinatorRequestLedger({
  createId: () => `coordinator-request:${uuidv4()}`,
  storage: coordinatorRequestFileStorage,
});

/** Text-only send through the coordinator inbox. Raw text is persisted before any provider turn. */
export function useSendCoordinatorMessage() {
  const send = useAtomCommand(serverEnvironment.sendProjectCoordinator, {
    label: "send coordinator message",
    reportFailure: false,
  });
  return useCallback(
    (input: { environmentId: EnvironmentId; projectId: ProjectId; text: string }) =>
      sendCoordinatorText({
        ledger: requestLedger,
        scopeKey: `${input.environmentId}:${input.projectId}`,
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
