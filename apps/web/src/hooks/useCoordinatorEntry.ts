import { scopeProjectRef } from "@yantrix/client-runtime/environment";
import type { EnvironmentProject } from "@yantrix/client-runtime/state/models";
import { useMemo } from "react";

import { useProject } from "../state/entities";
import { useProjectCoordinatorSupported } from "../state/projectCoordinator";
import { useHandleNewThread } from "./useHandleNewThread";
import { useOpenProjectCoordinator } from "./useOpenProjectCoordinator";

/**
 * The coordinator entry for the project the user is working in: the open
 * thread's or draft's project, else the top project, the same resolution
 * "New thread" uses. `project` is null when the host has no coordinator or
 * there is no project to open one for.
 */
export function useCoordinatorEntry(): {
  readonly project: EnvironmentProject | null;
  readonly open: () => void;
} {
  const { activeThread, activeDraftThread, defaultProjectRef } = useHandleNewThread();
  const contextualRef = useMemo(() => {
    const source = activeThread ?? activeDraftThread;
    return source ? scopeProjectRef(source.environmentId, source.projectId) : defaultProjectRef;
  }, [activeDraftThread, activeThread, defaultProjectRef]);
  const project = useProject(contextualRef);
  const supported = useProjectCoordinatorSupported(project?.environmentId ?? null);
  const openCoordinator = useOpenProjectCoordinator();
  const entryProject = supported ? project : null;
  return useMemo(
    () => ({
      project: entryProject,
      open: () => {
        if (entryProject) void openCoordinator(entryProject);
      },
    }),
    [entryProject, openCoordinator],
  );
}
