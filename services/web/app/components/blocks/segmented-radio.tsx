interface SegmentedRadioProps<T extends string | number> {
  ariaLabel: string;
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  renderLabel: (option: T) => string;
}

/**
 * Pill-style radio group for billing / region / mode / leasing-term
 * toggles. Accepts string or numeric values so the term selector can
 * pass `12 | 24 | …` directly.
 */
export function SegmentedRadio<T extends string | number>({
  ariaLabel,
  options,
  value,
  onChange,
  renderLabel,
}: SegmentedRadioProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
    >
      {options.map((option) => {
        const isActive = value === option;
        return (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option)}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-bg-base text-fg-base shadow-sm'
                : 'text-fg-muted hover:text-fg-base cursor-pointer'
            }`}
          >
            {renderLabel(option)}
          </button>
        );
      })}
    </div>
  );
}
