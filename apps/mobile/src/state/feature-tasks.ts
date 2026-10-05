import type { FeatureTask, EnvironmentId } from "@yantrix/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { useAtomValue } from "@effect/atom-react";

import { environmentServerConfigsAtom, serverEnvironment } from "./server";

export interface MobileFeatureTaskSnapshot {
  readonly tasks: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly task: FeatureTask;
  }>;
  readonly supportedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly loadingEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly failedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}

export const featureTaskSnapshotAtom = Atom.make((get): MobileFeatureTaskSnapshot => {
  const tasks: Array<{ readonly environmentId: EnvironmentId; readonly task: FeatureTask }> = [];
  const supportedEnvironmentIds: EnvironmentId[] = [];
  const loadingEnvironmentIds: EnvironmentId[] = [];
  const failedEnvironmentIds: EnvironmentId[] = [];

  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.featureTasks !== true) continue;
    supportedEnvironmentIds.push(environmentId);

    const result = get(serverEnvironment.featureTasksLive({ environmentId, input: {} }));
    const value = AsyncResult.value(result);
    if (Option.isNone(value)) {
      if (result._tag === "Failure") failedEnvironmentIds.push(environmentId);
      else loadingEnvironmentIds.push(environmentId);
      continue;
    }
    for (const task of value.value.tasks) tasks.push({ environmentId, task });
  }

  return { tasks, supportedEnvironmentIds, loadingEnvironmentIds, failedEnvironmentIds };
}).pipe(Atom.withLabel("mobile-feature-task-snapshots"));

export function useFeatureTaskSnapshots(): MobileFeatureTaskSnapshot {
  return useAtomValue(featureTaskSnapshotAtom);
}
