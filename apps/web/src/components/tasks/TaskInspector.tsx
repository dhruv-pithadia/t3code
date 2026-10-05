import { Tabs } from "@base-ui/react/tabs";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button";
import type { TaskInspectorTab } from "./TaskInspector.logic";

export interface TaskInspectorTabSpec {
  readonly id: TaskInspectorTab;
  readonly label: string;
  /** Count or short qualifier shown after the label. */
  readonly count?: number;
  /** Something in this tab may need the user; shown as a dot with a screen reader label. */
  readonly attention?: boolean;
  readonly content: ReactNode;
}

/**
 * Flat task inspector frame: a fixed tab bar on top and one pane below. Each
 * pane renders its own body and footer through InspectorPane, so only the body
 * scrolls and the contextual actions stay in view.
 */
export function TaskInspector({
  tab,
  onTabChange,
  tabs,
  onClose,
}: {
  readonly tab: TaskInspectorTab;
  readonly onTabChange: (tab: TaskInspectorTab) => void;
  readonly tabs: ReadonlyArray<TaskInspectorTabSpec>;
  readonly onClose: () => void;
}) {
  const activeTab = tabs.some((entry) => entry.id === tab) ? tab : (tabs[0]?.id ?? "workspace");
  return (
    <Tabs.Root
      value={activeTab}
      onValueChange={(value) => onTabChange(value as TaskInspectorTab)}
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border/70 pr-2 pl-3">
        <Tabs.List className="flex min-w-0 flex-1 items-center gap-1">
          {tabs.map((entry) => (
            <Tabs.Tab
              key={entry.id}
              value={entry.id}
              className="relative flex h-10 cursor-pointer items-center gap-1.5 px-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground data-active:text-foreground data-active:after:absolute data-active:after:inset-x-1 data-active:after:bottom-0 data-active:after:h-0.5 data-active:after:rounded-full data-active:after:bg-foreground rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:h-9"
            >
              {entry.label}
              {entry.count !== undefined ? (
                <span className="text-xs text-muted-foreground tabular-nums">{entry.count}</span>
              ) : null}
              {entry.attention ? (
                <>
                  <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                  <span className="sr-only">needs attention</span>
                </>
              ) : null}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close details" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {tabs.map((entry) => (
        <Tabs.Panel
          key={entry.id}
          value={entry.id}
          keepMounted
          className="flex min-h-0 flex-1 flex-col outline-none data-hidden:hidden"
        >
          {entry.content}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

/** Scrolling body with an optional pinned footer for the pane's actions. */
export function InspectorPane({
  children,
  footer,
}: {
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>
      {footer ? (
        <div className="shrink-0 border-t border-border/70 px-3 py-2.5">{footer}</div>
      ) : null}
    </>
  );
}
