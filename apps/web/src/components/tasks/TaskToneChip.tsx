import type { DeliveryTone } from "@yantrix/client-runtime/state/feature-task-workspace";

const TONE_CLASS: Record<DeliveryTone, string> = {
  neutral: "border-border text-muted-foreground",
  unknown: "border-border border-dashed text-muted-foreground",
  pending: "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  success: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  danger: "border-destructive/25 bg-destructive/8 text-destructive",
};

/** Small status label. Tone carries meaning but the text always states it too. */
export function TaskToneChip({
  tone,
  children,
}: {
  readonly tone: DeliveryTone;
  readonly children: React.ReactNode;
}) {
  return (
    <span className={`rounded border px-2 py-0.5 text-2xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
