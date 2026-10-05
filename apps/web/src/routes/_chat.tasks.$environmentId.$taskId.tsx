import { EnvironmentId, FeatureTaskId } from "@yantrix/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { TaskDetailPage } from "../components/tasks/TasksPage";

export const Route = createFileRoute("/_chat/tasks/$environmentId/$taskId")({
  component: FeatureTaskDetailRoute,
});

function FeatureTaskDetailRoute() {
  const { environmentId, taskId } = Route.useParams();
  return (
    <TaskDetailPage
      environmentId={EnvironmentId.make(environmentId)}
      taskId={FeatureTaskId.make(taskId)}
    />
  );
}
