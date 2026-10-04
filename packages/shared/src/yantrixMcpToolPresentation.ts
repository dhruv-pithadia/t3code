export type YantrixMcpToolLogo = "yantrix";

export interface YantrixMcpToolPresentation {
  readonly displayName: string;
  readonly logo: YantrixMcpToolLogo;
}

export type YantrixMcpToolSummaryAction =
  | "capabilities"
  | "delegate"
  | "task-status"
  | "task-cancel"
  | "schedule-run"
  | "schedule-create"
  | "schedule-list"
  | "schedule-update"
  | "schedule-delete"
  | "thread-create"
  | "thread-list"
  | "thread-read"
  | "thread-send"
  | "thread-wait"
  | "thread-interrupt"
  | "thread-configuration"
  | "thread-configure"
  | "thread-fork"
  | "thread-merge"
  | "thread-search"
  | "thread-transfers"
  | "thread-organize"
  | "thread-update"
  | "queue-list"
  | "queue-read"
  | "queue-edit"
  | "queue-cancel"
  | "queue-reorder"
  | "queue-steer"
  | "question-list"
  | "question-read"
  | "question-respond"
  | "worktree-handoff"
  | "worktree-list"
  | "worktree-status"
  | "project-list"
  | "project-read"
  | "project-create"
  | "project-update"
  | "project-delete"
  | "project-clone"
  | "environment-read"
  | "environment-update"
  | "attachment-prepare"
  | "attachment-discard"
  | "attachment-send"
  | "link-pr"
  | "unlink-pr"
  | "list-prs"
  | "watch-pr"
  | "unwatch-pr"
  | "browser"
  | "device";

export interface YantrixMcpToolDefinition {
  readonly displayName: string;
  readonly labels: readonly [action: string, running: string, completed: string, detail: string];
  readonly icon: "yantrix" | "browser" | "device" | "pull-request";
  readonly summaryAction: YantrixMcpToolSummaryAction;
}

function tool(
  labels: YantrixMcpToolDefinition["labels"],
  summaryAction: YantrixMcpToolSummaryAction,
  icon: YantrixMcpToolDefinition["icon"] = "yantrix",
  displayName = `${labels[0]} ${labels[3]}`,
): YantrixMcpToolDefinition {
  return { displayName, labels, icon, summaryAction };
}

const YANTRIX_MCP_SERVER_ALIASES = new Set(["yantrix"]);

// Cards, activity rows, summaries, and provider identity recovery share this inventory.
const YANTRIX_MCP_TOOLS: Readonly<Record<string, YantrixMcpToolDefinition>> = {
  link_pull_request: tool(
    ["Link", "Linking", "Linked", "a pull request"],
    "link-pr",
    "pull-request",
  ),
  unlink_pull_request: tool(
    ["Unlink", "Unlinking", "Unlinked", "a pull request"],
    "unlink-pr",
    "pull-request",
  ),
  list_thread_pull_requests: tool(
    ["Check", "Checking", "Checked", "linked pull requests"],
    "list-prs",
    "pull-request",
  ),
  watch_pull_request: tool(
    ["Watch", "Watching", "Watching", "a pull request"],
    "watch-pr",
    "pull-request",
  ),
  unwatch_pull_request: tool(
    ["Stop watching", "Stopping watching", "Stopped watching", "a pull request"],
    "unwatch-pr",
    "pull-request",
  ),
  orchestrator_capabilities: tool(
    ["Get", "Getting", "Got", "orchestration capabilities"],
    "capabilities",
  ),
  delegate_task: tool(["Delegate", "Delegating", "Delegated", "a child task"], "delegate"),
  task_status: tool(["Get", "Getting", "Got", "delegated task status"], "task-status"),
  task_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "delegated task"],
    "task-cancel",
  ),
  schedule_task: tool(
    ["Schedule", "Scheduling", "Scheduled", "a recurring task"],
    "schedule-create",
  ),
  list_scheduled_tasks: tool(["List", "Listing", "Listed", "scheduled tasks"], "schedule-list"),
  update_scheduled_task: tool(
    ["Update", "Updating", "Updated", "a scheduled task"],
    "schedule-update",
  ),
  delete_scheduled_task: tool(
    ["Delete", "Deleting", "Requested deletion of", "a scheduled task"],
    "schedule-delete",
  ),
  create_threads: tool(["Create", "Creating", "Created", "Yantrix threads"], "thread-create"),
  yantrix_thread_start: tool(["Start", "Starting", "Started", "a Yantrix thread"], "thread-create"),
  yantrix_thread_list: tool(["List", "Listing", "Listed", "Yantrix threads"], "thread-list"),
  yantrix_thread_read: tool(["Read", "Reading", "Read", "a Yantrix thread"], "thread-read"),
  yantrix_thread_send: tool(["Send", "Sending", "Sent", "to a Yantrix thread"], "thread-send"),
  yantrix_thread_wait: tool(["Wait", "Waiting", "Waited", "for a Yantrix thread"], "thread-wait"),
  yantrix_thread_interrupt: tool(
    ["Interrupt", "Interrupting", "Requested an interrupt of", "a Yantrix thread"],
    "thread-interrupt",
  ),
  yantrix_worktree_handoff: tool(
    ["Hand off", "Handing off", "Handed off", "thread to a git worktree"],
    "worktree-handoff",
  ),
  yantrix_worktree_status: tool(
    ["Get", "Getting", "Got", "thread worktree status"],
    "worktree-status",
  ),
  preview_status: tool(["Get", "Getting", "Got", "preview browser status"], "browser", "browser"),
  preview_open: tool(
    ["Open", "Opening", "Opened", "a page in the preview browser"],
    "browser",
    "browser",
  ),
  preview_navigate: tool(
    ["Navigate", "Navigating", "Navigated", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_snapshot: tool(
    ["Take a snapshot of", "Taking a snapshot of", "Took a snapshot of", "the preview page"],
    "browser",
    "browser",
    "Snapshot the preview page",
  ),
  preview_click: tool(
    ["Click", "Clicking", "Clicked", "in the preview browser"],
    "browser",
    "browser",
  ),
  preview_press: tool(
    ["Press", "Pressing", "Pressed", "a key in the preview browser"],
    "browser",
    "browser",
  ),
  preview_type: tool(["Type", "Typing", "Typed", "in the preview browser"], "browser", "browser"),
  preview_scroll: tool(
    ["Scroll", "Scrolling", "Scrolled", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_resize: tool(
    ["Resize", "Resizing", "Resized", "the preview browser"],
    "browser",
    "browser",
  ),
  preview_evaluate: tool(
    ["Evaluate", "Evaluating", "Evaluated", "script in the preview browser"],
    "browser",
    "browser",
  ),
  preview_wait_for: tool(
    ["Wait", "Waiting", "Waited", "for the preview page"],
    "browser",
    "browser",
  ),
  preview_set_appearance: tool(
    ["Set", "Setting", "Set", "preview browser appearance"],
    "browser",
    "browser",
  ),
  preview_recording_start: tool(
    ["Start", "Starting", "Started", "recording the preview browser"],
    "browser",
    "browser",
  ),
  preview_recording_stop: tool(
    ["Stop", "Stopping", "Stopped", "recording the preview browser"],
    "browser",
    "browser",
  ),
  device_list: tool(["List", "Listing", "Listed", "simulators and emulators"], "device", "device"),
  device_open: tool(
    ["Open", "Opening", "Opened", "a device in the Device panel"],
    "device",
    "device",
  ),
  device_screenshot: tool(
    ["Take a screenshot of", "Taking a screenshot of", "Took a screenshot of", "the device"],
    "device",
    "device",
  ),
  device_close: tool(["Close", "Closing", "Closed", "a device"], "device", "device"),
  run_scheduled_task_now: tool(
    ["Run", "Running", "Requested a run of", "a scheduled task"],
    "schedule-run",
  ),
  yantrix_queue_list: tool(["List", "Listing", "Listed", "queued messages"], "queue-list"),
  yantrix_queue_read: tool(["Read", "Reading", "Read", "a queued message"], "queue-read"),
  yantrix_queue_edit: tool(["Edit", "Editing", "Edited", "a queued message"], "queue-edit"),
  yantrix_queue_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a queued run"],
    "queue-cancel",
  ),
  yantrix_queue_reorder: tool(
    ["Reorder", "Reordering", "Reordered", "a queued run"],
    "queue-reorder",
  ),
  yantrix_queue_promote_to_steer: tool(
    ["Steer with", "Steering with", "Requested steering with", "a queued message"],
    "queue-steer",
  ),
  yantrix_pending_request_list: tool(
    ["List", "Listing", "Listed", "pending questions"],
    "question-list",
  ),
  yantrix_pending_request_read: tool(
    ["Read", "Reading", "Read", "pending questions"],
    "question-read",
  ),
  yantrix_pending_request_respond: tool(
    ["Answer", "Answering", "Answered", "pending questions"],
    "question-respond",
  ),
  yantrix_thread_configuration: tool(
    ["Read", "Reading", "Read", "thread configuration"],
    "thread-configuration",
  ),
  yantrix_thread_configure: tool(["Set", "Setting", "Set", "thread model"], "thread-configure"),
  yantrix_thread_fork: tool(
    ["Fork", "Forking", "Requested a fork of", "this thread"],
    "thread-fork",
  ),
  yantrix_thread_merge_back: tool(
    ["Merge", "Merging", "Requested a merge of", "thread context"],
    "thread-merge",
  ),
  yantrix_thread_search: tool(
    ["Search", "Searching", "Searched", "thread content"],
    "thread-search",
  ),
  yantrix_thread_transfers: tool(
    ["Read", "Reading", "Read", "thread transfers"],
    "thread-transfers",
  ),
  yantrix_thread_organize: tool(
    ["Organize", "Organizing", "Organized", "a thread"],
    "thread-organize",
  ),
  yantrix_thread_update: tool(
    ["Update", "Updating", "Updated", "Yantrix thread metadata"],
    "thread-update",
  ),
  yantrix_worktree_list: tool(["List", "Listing", "Listed", "workspace branches"], "worktree-list"),
  yantrix_preview_list: tool(["List", "Listing", "Listed", "preview tabs"], "browser", "browser"),
  yantrix_preview_close: tool(
    ["Close", "Closing", "Closed", "a preview tab"],
    "browser",
    "browser",
  ),
  yantrix_environment_read: tool(
    ["Read", "Reading", "Read", "environment preferences"],
    "environment-read",
  ),
  yantrix_environment_preferences_update: tool(
    ["Update", "Updating", "Updated", "environment preferences"],
    "environment-update",
  ),
  yantrix_thread_launch: tool(
    ["Launch", "Launching", "Launched", "a project thread"],
    "thread-create",
  ),
  yantrix_project_list: tool(["List", "Listing", "Listed", "projects"], "project-list"),
  yantrix_project_read: tool(["Read", "Reading", "Read", "a project"], "project-read"),
  yantrix_project_create: tool(
    ["Register", "Registering", "Registered", "a project"],
    "project-create",
  ),
  yantrix_project_update: tool(["Update", "Updating", "Updated", "a project"], "project-update"),
  yantrix_project_delete: tool(["Delete", "Deleting", "Deleted", "a project"], "project-delete"),
  yantrix_project_clone: tool(["Clone", "Cloning", "Cloned", "a repository"], "project-clone"),
  yantrix_attachment_prepare_upload: tool(
    ["Prepare", "Preparing", "Prepared", "an attachment upload"],
    "attachment-prepare",
  ),
  yantrix_attachment_discard: tool(
    ["Discard", "Discarding", "Discarded", "a pending attachment"],
    "attachment-discard",
  ),
  yantrix_thread_send_attachments: tool(
    ["Send", "Sending", "Sent", "attachments"],
    "attachment-send",
  ),
};

/**
 * The Yantrix orchestration tool inventory, used to gate loose name matching on
 * both the server (ACP MCP identity recovery) and the client (logo branding).
 */
export const YANTRIX_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(YANTRIX_MCP_TOOLS));

function normalizeYantrixMcpToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

/**
 * ACP agents disagree on how the injected Yantrix server prefixes its tools:
 * `mcp__yantrix__x` (Claude/Cursor), `yantrix.x` (Codex), plus single
 * underscore, colon, slash, dash, and space separators seen from registry
 * agents. The prefix match is deliberately loose because the display-name
 * inventory is the real gate; unknown tools stay on the generic renderer.
 */
function resolveYantrixMcpToolName(value: string): string | null {
  const label = normalizeYantrixMcpToolLabel(value);
  if (Object.hasOwn(YANTRIX_MCP_TOOLS, label)) return label;
  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(label);
  if (mcpMatch?.groups) {
    const { server, tool } = mcpMatch.groups;
    return server !== undefined &&
      tool !== undefined &&
      YANTRIX_MCP_SERVER_ALIASES.has(server.toLowerCase())
      ? tool
      : null;
  }

  const namespaceMatch = /^(?<server>yantrix)(?:[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(label);
  if (namespaceMatch?.groups) {
    return namespaceMatch.groups.tool ?? null;
  }

  const prefixed = /^(?:mcp[-_]{1,2})?yantrix(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(label);
  const candidate = prefixed?.groups?.tool ?? label;
  return Object.hasOwn(YANTRIX_MCP_TOOLS, candidate) ? candidate : null;
}

export function resolveYantrixMcpToolDefinition(
  toolName: string | null | undefined,
): YantrixMcpToolDefinition | null {
  const name = toolName == null ? null : resolveYantrixMcpToolName(toolName);
  return name !== null && Object.hasOwn(YANTRIX_MCP_TOOLS, name) ? YANTRIX_MCP_TOOLS[name]! : null;
}

export function resolveYantrixMcpToolPresentation(
  toolName: string | null | undefined,
): YantrixMcpToolPresentation | null {
  const definition = resolveYantrixMcpToolDefinition(toolName);
  return definition === null ? null : { displayName: definition.displayName, logo: "yantrix" };
}

export function resolveYantrixMcpToolSummaryAction(
  toolName: string | null | undefined,
): YantrixMcpToolSummaryAction | null {
  return resolveYantrixMcpToolDefinition(toolName)?.summaryAction ?? null;
}
