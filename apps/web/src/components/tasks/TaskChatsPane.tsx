import { EllipsisIcon, LinkIcon, PlusIcon, UnlinkIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { InspectorPane } from "./TaskInspector";
import type { ChatRow } from "./TaskInspector.logic";
import type { ChatsPaneState } from "./TaskInspector.state";
import { TaskToneChip } from "./TaskToneChip";

/** Dense list of the task's linked conversations with the actions to add to it. */
export function TaskChatsPane({
  rows,
  notes,
  busy,
  canStart,
  onStart,
  onOpen,
  onUnlink,
  candidates,
  linkSelection,
  onLinkSelectionChange,
  onLink,
  linkError,
  state,
}: {
  readonly state: ChatsPaneState;
  readonly rows: ReadonlyArray<ChatRow>;
  /** Explanations that apply to the whole list, such as unavailable or other-workspace chats. */
  readonly notes: ReadonlyArray<string>;
  readonly busy: boolean;
  readonly canStart: boolean;
  readonly onStart: () => void;
  readonly onOpen: (threadId: string) => void;
  readonly onUnlink: (threadId: string) => void;
  readonly candidates: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly linkSelection: string;
  readonly onLinkSelectionChange: (threadId: string) => void;
  readonly onLink: () => void;
  readonly linkError: string | null;
}) {
  const { pickerOpen, setPickerOpen } = state;
  // A failed link keeps its selection, so the picker stays open to retry it.
  const showPicker = candidates.length > 0 && (pickerOpen || linkSelection !== "");

  const footer = (
    <div className="grid gap-2">
      {showPicker ? (
        <div className="flex items-center gap-2">
          <select
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24"
            aria-label="Choose a conversation to link"
            value={linkSelection}
            onChange={(event) => onLinkSelectionChange(event.currentTarget.value)}
          >
            <option value="">Link a conversation…</option>
            {candidates.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title || "Untitled conversation"}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || !linkSelection} onClick={onLink}>
            Link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setPickerOpen(false);
              onLinkSelectionChange("");
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy || !canStart} onClick={onStart}>
          <PlusIcon />
          New conversation
        </Button>
        {candidates.length > 0 && !showPicker ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setPickerOpen(true)}>
            <LinkIcon />
            Link existing
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <InspectorPane footer={footer}>
      {linkError ? (
        <p role="alert" className="mb-3 text-xs leading-relaxed text-destructive">
          {linkError}{" "}
          {linkSelection ? (
            <button className="underline" disabled={busy} onClick={onLink}>
              Retry link
            </button>
          ) : null}
        </p>
      ) : null}
      {rows.length ? (
        <ul className="-mx-1 divide-y divide-border/60">
          {rows.map((row) => (
            <li key={row.threadId} className="flex items-start gap-1 py-1.5">
              {row.available ? (
                <button
                  type="button"
                  onClick={() => onOpen(row.threadId)}
                  className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RowText row={row} />
                </button>
              ) : (
                <div className="min-w-0 flex-1 px-1.5 py-1">
                  <RowText row={row} />
                </div>
              )}
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={`Actions for ${row.title}`}
                      disabled={busy}
                    />
                  }
                >
                  <EllipsisIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem variant="destructive" onClick={() => onUnlink(row.threadId)}>
                    <UnlinkIcon />
                    Unlink from task
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No conversations linked yet.</p>
      )}
      {notes.map((note) => (
        <p key={note} className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {note}
        </p>
      ))}
    </InspectorPane>
  );
}

function RowText({ row }: { readonly row: ChatRow }) {
  const meta = [
    row.isLatest ? "Latest" : null,
    row.updatedAt ? formatRelativeTimeLabel(row.updatedAt) : null,
    row.provider,
  ].filter((part): part is string => part !== null && part !== "");
  return (
    <>
      <span className="block truncate text-sm font-medium">{row.title}</span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {meta.join(" · ")}
        {row.badge ? <TaskToneChip tone={row.badge.tone}>{row.badge.label}</TaskToneChip> : null}
      </span>
    </>
  );
}
