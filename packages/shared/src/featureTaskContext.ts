import { FeatureTask } from "@yantrix/contracts";
import * as Schema from "effect/Schema";

const encodeTask = Schema.encodeSync(Schema.fromJsonString(FeatureTask));

/** Keep task intent available across conversations without replaying their history. */
export function formatFeatureTaskContext(task: FeatureTask): string {
  if (task.archivedAt !== null) return "";
  const context = encodeTask(task);
  // Large handoffs remain retrievable through the task tool. Bound repeated turn context.
  const maxCharacters = 16_000;
  const bounded = Array.from(context).slice(0, maxCharacters).join("");
  const omitted = bounded.length < context.length;
  return [
    "Saved Yantrix task context (user-maintained intent, not verification evidence):",
    bounded,
    ...(omitted
      ? [
          "Task context was shortened. Read the full task with yantrix_feature_task_read before relying on omitted details.",
        ]
      : []),
    "Check the actual workspace and pull request state before continuing. Task status does not prove tests passed or a merge occurred. Merge approval remains with the user.",
  ].join("\n");
}
