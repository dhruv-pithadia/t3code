import {
  FeatureTaskId,
  type EnvironmentId,
  type FeatureTask,
  type FeatureTaskStatus,
  type ProjectId,
} from "@yantrix/contracts";
import { useMemo, useState } from "react";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import {
  useCreateFeatureTask,
  useFeatureTaskEnvironments,
  useUpdateFeatureTask,
} from "../../state/featureTasks";
import { randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@yantrix/client-runtime/state/runtime";
import { stackedThreadToast, toastManager } from "../ui/toast";

const STATUSES: ReadonlyArray<{ value: FeatureTaskStatus; label: string }> = [
  { value: "requested", label: "Requested" },
  { value: "planning", label: "Planning" },
  { value: "building", label: "Building" },
  { value: "verifying", label: "Verifying" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "paused", label: "Paused" },
  { value: "blocked", label: "Blocked" },
];

function toLines(value: string): ReadonlyArray<string> {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function fromLines(value: ReadonlyArray<string>): string {
  return value.join("\n");
}

export function TaskEditorDialog({
  environmentId: initialEnvironmentId,
  projectId: initialProjectId,
  task,
  onClose,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId?: ProjectId;
  readonly task?: FeatureTask;
  readonly onClose: () => void;
  readonly onSaved: (task: FeatureTask, environmentId: EnvironmentId) => void;
}) {
  const projects = useProjects();
  const { environments } = useEnvironments();
  const supportedEnvironmentIds = useFeatureTaskEnvironments();
  const [environmentId, setEnvironmentId] = useState(initialEnvironmentId);
  const [openingTask] = useState(() => (task ? { id: task.id, version: task.version } : null));
  const availableProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.environmentId === environmentId &&
          supportedEnvironmentIds.includes(project.environmentId),
      ),
    [environmentId, projects, supportedEnvironmentIds],
  );
  const [projectId, setProjectId] = useState<ProjectId>(
    task?.projectId ?? initialProjectId ?? availableProjects[0]?.id ?? ("" as ProjectId),
  );
  const [title, setTitle] = useState(task?.title ?? "");
  const [objective, setObjective] = useState(task?.objective ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(
    fromLines(task?.acceptanceCriteria ?? []),
  );
  const [decisions, setDecisions] = useState(fromLines(task?.decisions ?? []));
  const [nextAction, setNextAction] = useState(task?.nextAction ?? "");
  const [handoff, setHandoff] = useState(task?.handoff ?? "");
  const [status, setStatus] = useState<FeatureTaskStatus>(task?.status ?? "requested");
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const create = useCreateFeatureTask();
  const update = useUpdateFeatureTask();
  const [createId] = useState(() => FeatureTaskId.make(randomUUID()));
  const project = availableProjects.find((candidate) => candidate.id === projectId);

  const save = async () => {
    if (saving) return;
    if (!title.trim() || !objective.trim() || !projectId) {
      setValidationError("Add a title, objective, and project to continue.");
      return;
    }
    setValidationError(null);
    setSaving(true);
    const result = openingTask
      ? await update({
          environmentId,
          input: {
            id: openingTask.id,
            expectedVersion: openingTask.version,
            patch: {
              title: title.trim(),
              objective: objective.trim(),
              acceptanceCriteria: toLines(acceptanceCriteria),
              decisions: toLines(decisions),
              nextAction: nextAction.trim(),
              handoff: handoff.trim(),
              status,
            },
          },
        })
      : await create({
          environmentId,
          input: {
            id: createId,
            projectId,
            title: title.trim(),
            objective: objective.trim(),
            acceptanceCriteria: toLines(acceptanceCriteria),
            decisions: toLines(decisions),
            nextAction: nextAction.trim(),
            handoff: handoff.trim(),
            threadIds: [],
          },
        });
    setSaving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      if (
        typeof failure === "object" &&
        failure !== null &&
        "code" in failure &&
        failure.code === "conflict"
      ) {
        setValidationError(
          "This task changed after you opened the editor. Your edits are still here. Close and reopen the editor to load the latest values before saving.",
        );
        return;
      }
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: task ? "Could not update task" : "Could not create task",
            description: String(failure),
          }),
        );
      }
      return;
    }
    onSaved(result.value.task, environmentId);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogPopup className="flex max-h-[min(90dvh,52rem)] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "Create task"}</DialogTitle>
          <DialogDescription>
            Keep the goal and the next useful step clear so work can resume across conversations.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          <div className="grid gap-4">
            {!task ? (
              <Field label="Workspace">
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24"
                  value={environmentId}
                  onChange={(event) => {
                    const nextEnvironmentId = event.currentTarget.value as EnvironmentId;
                    setEnvironmentId(nextEnvironmentId);
                    const nextProject = projects.find(
                      (candidate) => candidate.environmentId === nextEnvironmentId,
                    );
                    setProjectId(nextProject?.id ?? ("" as ProjectId));
                  }}
                  disabled={supportedEnvironmentIds.length < 2}
                >
                  {supportedEnvironmentIds.map((id) => (
                    <option key={id} value={id}>
                      {environments.find((item) => item.environmentId === id)?.label ?? id}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {!task ? (
              <Field label="Project">
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24"
                  value={projectId}
                  onChange={(event) => setProjectId(event.currentTarget.value as ProjectId)}
                  disabled={availableProjects.length < 2}
                >
                  {availableProjects.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Title">
              <Input
                nativeInput
                aria-label="Title"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                autoFocus
                maxLength={240}
                placeholder="A short name for the work"
              />
            </Field>
            <Field label="Objective" hint="What outcome should this task produce?">
              <Textarea
                aria-label="Objective"
                value={objective}
                onChange={(event) => setObjective(event.currentTarget.value)}
                rows={3}
                placeholder="Describe the intended outcome"
              />
            </Field>
            <Field label="Acceptance criteria" hint="One item per line">
              <Textarea
                aria-label="Acceptance criteria"
                value={acceptanceCriteria}
                onChange={(event) => setAcceptanceCriteria(event.currentTarget.value)}
                rows={3}
                placeholder="The behavior is visible to the user\nThe work survives a restart"
              />
            </Field>
            <Field label="Decisions" hint="One item per line">
              <Textarea
                aria-label="Decisions"
                value={decisions}
                onChange={(event) => setDecisions(event.currentTarget.value)}
                rows={3}
                placeholder="Choices that should carry into the next conversation"
              />
            </Field>
            <Field label="Next action">
              <Textarea
                aria-label="Next action"
                value={nextAction}
                onChange={(event) => setNextAction(event.currentTarget.value)}
                rows={2}
                placeholder="The next concrete step"
              />
            </Field>
            <Field label="Handoff" hint="Optional context for the next agent session">
              <Textarea
                aria-label="Handoff"
                value={handoff}
                onChange={(event) => setHandoff(event.currentTarget.value)}
                rows={3}
                placeholder="Useful context to resume the work"
              />
            </Field>
            {task ? (
              <Field label="Status">
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24"
                  value={status}
                  onChange={(event) => setStatus(event.currentTarget.value as FeatureTaskStatus)}
                >
                  {STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            {validationError ? (
              <p role="alert" className="text-sm text-destructive">
                {validationError}
              </p>
            ) : null}
            {!task && availableProjects.length === 0 ? (
              <p role="alert" className="text-sm text-destructive">
                No project is available in this workspace.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !project || !title.trim() || !objective.trim()}
          >
            {saving ? "Saving…" : task ? "Save changes" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
        {label}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
