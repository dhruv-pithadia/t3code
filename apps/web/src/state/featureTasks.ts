import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  FeatureTask,
  FeatureTaskId,
  FeatureTaskListInput,
} from "@yantrix/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentQuery, formatEnvironmentQueryError } from "./query";
import { serverEnvironment, environmentServerConfigsAtom } from "./server";
import { useEnvironmentIds } from "./environments";
import { useAtomCommand } from "./use-atom-command";

export interface FeatureTaskEnvironment {
  readonly environmentId: EnvironmentId;
  readonly tasks: ReadonlyArray<FeatureTask>;
}

interface MergedFeatureTaskList {
  readonly values: ReadonlyArray<FeatureTaskEnvironment>;
  readonly error: string | null;
  readonly isPending: boolean;
}

const useMergedFeatureTaskList = (() => {
  const family = Atom.family((key: string) =>
    Atom.make((get): MergedFeatureTaskList => {
      const targets = JSON.parse(key) as ReadonlyArray<{
        readonly environmentId: EnvironmentId;
        readonly input: FeatureTaskListInput;
      }>;
      const values: FeatureTaskEnvironment[] = [];
      let error: string | null = null;
      let isPending = false;
      for (const target of targets) {
        const result = get(serverEnvironment.featureTasksLive(target));
        if (result._tag === "Failure" && error === null) {
          error = formatEnvironmentQueryError(result.cause);
        }
        const value = Option.getOrNull(AsyncResult.value(result));
        if (value !== null)
          values.push({ environmentId: target.environmentId, tasks: value.tasks });
        else isPending ||= result.waiting;
      }
      return { values, error, isPending };
    }).pipe(Atom.withLabel(`web-feature-tasks:list:${key}`)),
  );
  const empty = Atom.make<MergedFeatureTaskList>({
    values: [],
    error: null,
    isPending: false,
  }).pipe(Atom.withLabel("web-feature-tasks:list:empty"));
  return (
    targets: ReadonlyArray<{
      readonly environmentId: EnvironmentId;
      readonly input: FeatureTaskListInput;
    }>,
  ) => {
    const key = JSON.stringify(targets);
    const view = useAtomValue(targets.length === 0 ? empty : family(key));
    const refresh = useCallback(() => {
      const refreshTargets = JSON.parse(key) as ReadonlyArray<{
        readonly environmentId: EnvironmentId;
        readonly input: FeatureTaskListInput;
      }>;
      for (const target of refreshTargets)
        appAtomRegistry.refresh(serverEnvironment.featureTasksLive(target));
    }, [key]);
    return { ...view, refresh };
  };
})();

export function useFeatureTaskEnvironments() {
  const environmentIds = useEnvironmentIds();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  return useMemo(
    () =>
      environmentIds.filter(
        (environmentId) =>
          serverConfigs.get(environmentId)?.environment.capabilities.featureTasks === true,
      ),
    [environmentIds, serverConfigs],
  );
}

export function useFeatureTasks(projectId?: FeatureTaskListInput["projectId"]) {
  const environments = useFeatureTaskEnvironments();
  const targets = useMemo(
    () =>
      environments.map((environmentId) => ({
        environmentId,
        input: projectId ? { projectId } : {},
      })),
    [environments, projectId],
  );
  return useMergedFeatureTaskList(targets);
}

export function useFeatureTask(environmentId: EnvironmentId | null, id: FeatureTaskId | null) {
  const query = useEnvironmentQuery(
    environmentId !== null && id !== null
      ? serverEnvironment.getFeatureTask({ environmentId, input: { id } })
      : null,
  );
  return { ...query, task: query.data?.task ?? null };
}

export function useCreateFeatureTask() {
  return useAtomCommand(serverEnvironment.createFeatureTask, { label: "create feature task" });
}

export function useUpdateFeatureTask() {
  return useAtomCommand(serverEnvironment.updateFeatureTask, { label: "update feature task" });
}

export function useReadFeatureTask() {
  return useAtomCommand(serverEnvironment.readFeatureTask, { label: "read feature task" });
}
