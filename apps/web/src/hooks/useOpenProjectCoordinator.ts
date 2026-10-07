import { scopeThreadRef } from "@yantrix/client-runtime/environment";
import {
  COORDINATOR_REQUIRES_CODEX_MESSAGE,
  describeCoordinatorError,
} from "@yantrix/client-runtime/state/project-coordinator";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@yantrix/client-runtime/state/runtime";
import { DEFAULT_SERVER_SETTINGS, type ModelSelection } from "@yantrix/contracts";
import type { EnvironmentProject } from "@yantrix/client-runtime/state/models";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { scheduledTaskDefaultModel } from "../components/settings/scheduledTasksSettings.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";

/** The first coordinator slice runs on Codex only, so selection is limited to Codex instances. */
function resolveCoordinatorModelSelection(project: EnvironmentProject): ModelSelection | null {
  const settings =
    appAtomRegistry.get(serverEnvironment.settingsValueAtom(project.environmentId)) ??
    DEFAULT_SERVER_SETTINGS;
  const providers =
    appAtomRegistry.get(serverEnvironment.providersValueAtom(project.environmentId)) ??
    EMPTY_SERVER_PROVIDERS;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  ).filter((entry) => entry.driverKind === "codex");
  return scheduledTaskDefaultModel(settings, project, entries);
}

/**
 * Opens (or creates on first use) the project's coordinator conversation and
 * navigates to it. Opening never starts a turn.
 */
export function useOpenProjectCoordinator() {
  const navigate = useNavigate();
  const open = useAtomCommand(serverEnvironment.openProjectCoordinator, {
    label: "open project coordinator",
    reportFailure: false,
  });
  return useCallback(
    async (project: EnvironmentProject): Promise<boolean> => {
      const modelSelection = resolveCoordinatorModelSelection(project);
      if (modelSelection === null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Coordinator unavailable",
            description: COORDINATOR_REQUIRES_CODEX_MESSAGE,
          }),
        );
        return false;
      }
      const result = await open({
        environmentId: project.environmentId,
        input: { projectId: project.id, modelSelection },
      });
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not open the coordinator",
              description: describeCoordinatorError(squashAtomCommandFailure(result)),
            }),
          );
        }
        return false;
      }
      const threadId = result.value.threadId;
      if (threadId === null) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open the coordinator",
            description: "The coordinator conversation is not available yet. Try again.",
          }),
        );
        return false;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(project.environmentId, threadId)),
      });
      return true;
    },
    [navigate, open],
  );
}
