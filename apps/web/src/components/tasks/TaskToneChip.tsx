import type { DeliveryTone } from "@yantrix/client-runtime/state/feature-task-workspace";

const TONE_CLASS: Record<DeliveryTone, string> = {
  neutral: "border-border text-muted-foreground",
  unknown: "border-border border-dashed text-muted-foreground",
  pending: "border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300",
  success: "border-emerald-500/25 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300",
  danger: "border-destructive/25 bg-destructive/8 text-destructive",
};

const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-2xs font-medium";

/** Small status label. Tone carries meaning but the text always states it too. */
export function TaskToneChip({
  tone,
  children,
  onClick,
  "aria-label": ariaLabel,
}: {
  readonly tone: DeliveryTone;
  readonly children: React.ReactNode;
  /** Makes the chip a button, for status that opens the matching inspector tab. */
  readonly onClick?: () => void;
  readonly "aria-label"?: string;
}) {
  if (onClick) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={`${CHIP_CLASS} ${TONE_CLASS[tone]} cursor-pointer outline-none transition-[background-color,box-shadow,scale] hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.97]`}
      >
        {children}
      </button>
    );
  }
  return <span className={`${CHIP_CLASS} ${TONE_CLASS[tone]}`}>{children}</span>;
}
