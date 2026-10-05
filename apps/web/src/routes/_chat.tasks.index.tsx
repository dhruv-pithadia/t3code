import { createFileRoute } from "@tanstack/react-router";

import { TasksListPage } from "../components/tasks/TasksPage";

export const Route = createFileRoute("/_chat/tasks/")({ component: TasksListPage });
