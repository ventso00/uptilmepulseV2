import { periodLabels, periodOptions } from "@shared/contracts";

export type Period = (typeof periodOptions)[number];

/**
 * Exposes the periods the API already supports. Previously the 24h and 7d
 * options were dead server capability while the UI hardcoded 30 days in six
 * places.
 */
export function PeriodSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: Period;
  onChange: (value: Period) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Période analysée"
      className="flex items-center gap-1 rounded-xl border border-line p-1"
    >
      {periodOptions.map(option => (
        <button
          key={option}
          onClick={() => onChange(option)}
          disabled={disabled}
          aria-pressed={value === option}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            value === option
              ? "bg-brand-subtle text-brand-strong"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {periodLabels[option]}
        </button>
      ))}
    </div>
  );
}
