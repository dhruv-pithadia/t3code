import { useState } from "react";

import type { FeatureTaskWorkspaceAction } from "@yantrix/client-runtime/state/feature-task-workspace";

export type AttachStage = "closed" | "input" | "confirm";

/**
 * Workspace pane operation state. It lives above the inspector so collapsing it
 * or crossing the dock/sheet breakpoint (which mounts the panes in a different
 * parent) keeps the typed path, review stage, running action, and error. The
 * page that owns it is keyed per task, so drafts never carry across tasks.
 */
export function useWorkspacePaneState() {
  const [running, setRunning] = useState<FeatureTaskWorkspaceAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachStage, setAttachStage] = useState<AttachStage>("closed");
  const [attachPath, setAttachPath] = useState("");
  const [attachInvalid, setAttachInvalid] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return {
    running,
    setRunning,
    actionError,
    setActionError,
    attachStage,
    setAttachStage,
    attachPath,
    setAttachPath,
    attachInvalid,
    setAttachInvalid,
    detailsOpen,
    setDetailsOpen,
  };
}
export type WorkspacePaneState = ReturnType<typeof useWorkspacePaneState>;

/** Chats pane state that must survive the same remounts. */
export function useChatsPaneState() {
  const [pickerOpen, setPickerOpen] = useState(false);
  return { pickerOpen, setPickerOpen };
}
export type ChatsPaneState = ReturnType<typeof useChatsPaneState>;
