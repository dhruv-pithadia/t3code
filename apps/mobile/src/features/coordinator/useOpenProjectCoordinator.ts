import { useNavigation } from "@react-navigation/native";
import {
  COORDINATOR_REQUIRES_CODEX_MESSAGE,
  describeCoordinatorError,
} from "@yantrix/client-runtime/state/project-coordinator";
import { squashAtomCommandFailure } from "@yantrix/client-runtime/state/runtime";
import type { EnvironmentProject } from "@yantrix/client-runtime/state/shell";
import type { ModelSelection } from "@yantrix/contracts";
import { useCallback } from "react";
import { Alert } from "react-native";

import { appAtomRegistry } from "../../state/atom-registry";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";

/** The first coordinator slice runs on Codex only, so selection is limited to Codex instances. */
function resolveCoordinatorModelSelection(project: EnvironmentProject): ModelSelection | null {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId);
  if (!config) return null;
  const codexOnly = {
    ...config,
    providers: config.providers.filter((provider) => provider.driver === "codex"),
  };
  if (codexOnly.providers.length === 0) return null;
  return scheduledTaskDefaultModel(codexOnly, project);
}

/**
 * Opens (or creates on first use) the project's coordinator conversation and
 * navigates to it. Opening never starts a turn.
 */
export function useOpenProjectCoordinator() {
  const navigation = useNavigation();
  const open = useAtomCommand(serverEnvironment.openProjectCoordinator, {
    label: "open project coordinator",
    reportFailure: false,
  });
  return useCallback(
    async (project: EnvironmentProject): Promise<boolean> => {
      const modelSelection = resolveCoordinatorModelSelection(project);
      if (modelSelection === null) {
        Alert.alert("Coordinator unavailable", COORDINATOR_REQUIRES_CODEX_MESSAGE);
        return false;
      }
      const result = await open({
        environmentId: project.environmentId,
        input: { projectId: project.id, modelSelection },
      });
      if (result._tag === "Failure") {
        Alert.alert(
          "Could not open the coordinator",
          describeCoordinatorError(squashAtomCommandFailure(result)),
        );
        return false;
      }
      const threadId = result.value.threadId;
      if (threadId === null) {
        Alert.alert(
          "Could not open the coordinator",
          "The coordinator conversation is not available yet. Try again.",
        );
        return false;
      }
      navigation.navigate("Thread", {
        environmentId: String(project.environmentId),
        threadId: String(threadId),
      });
      return true;
    },
    [navigation, open],
  );
}
