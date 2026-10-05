import type { ModelSelection } from "@yantrix/contracts";
import type { EnvironmentThreadShell } from "@yantrix/client-runtime/state/models";

export interface LinkedFeatureTaskThread {
  readonly threadId: EnvironmentThreadShell["id"];
  readonly thread: Pick<
    EnvironmentThreadShell,
    | "id"
    | "updatedAt"
    | "modelSelection"
    | "branch"
    | "worktreePath"
    | "runtimeMode"
    | "interactionMode"
  > | null;
}

/** Missing linked shells must never outrank a conversation the user can resume. */
export function latestAvailableTaskThread(
  threads: ReadonlyArray<LinkedFeatureTaskThread>,
): LinkedFeatureTaskThread | null {
  let latest: LinkedFeatureTaskThread | null = null;
  for (const candidate of threads) {
    if (candidate.thread === null) continue;
    if (latest === null || candidate.thread.updatedAt > latest.thread!.updatedAt)
      latest = candidate;
  }
  return latest;
}

/** The launch endpoint requires a real model; the local no-provider sentinel is not valid here. */
export function selectFeatureTaskConversationModel(
  linkedThread: Pick<EnvironmentThreadShell, "modelSelection"> | null,
  defaultSelection: ModelSelection | null,
): ModelSelection | null {
  const selection = linkedThread?.modelSelection ?? defaultSelection;
  return selection !== null && selection.model.trim().length > 0 ? selection : null;
}
