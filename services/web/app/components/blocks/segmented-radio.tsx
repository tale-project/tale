import { useRef, type KeyboardEvent } from 'react';

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
 *
 * Keyboard contract (WAI-ARIA APG radio pattern, round-2 R2-B12):
 *  - Only the currently-checked option is in the tab sequence
 *    (`tabIndex=0`); the rest are `tabIndex=-1`.
 *  - ArrowLeft / ArrowUp move selection back; ArrowRight / ArrowDown move
 *    selection forward; selection wraps at both ends. Home / End jump to
 *    the extremes. Each arrow press both selects and focuses the new
 *    option, matching the canonical radio-group keyboard model.
 *  - Space / Enter activation is handled natively by the underlying
 *    `<button>` elements.
 */
export function SegmentedRadio<T extends string | number>({
  ariaLabel,
  options,
  value,
  onChange,
  renderLabel,
}: SegmentedRadioProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (
    e: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + options.length) % options.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextOption = options[nextIndex];
    if (nextOption === undefined) return;
    onChange(nextOption);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="bg-bg-elevated flex w-fit items-center gap-1 rounded-md p-0.5"
    >
      {options.map((option, index) => {
        const isActive = value === option;
        return (
          <button
            key={String(option)}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(e) => handleKeyDown(e, index)}
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
