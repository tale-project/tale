'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import { useWizard } from './use-wizard';

export interface WizardProgressProps {
  /** Accessible name for the step list (translated by caller). */
  ariaLabel: string;
  className?: string;
}

/**
 * Step indicator. Two layouts share one source of truth:
 *
 *  - **≥ sm**: evenly-distributed columns — a numbered circle with the label
 *    centered *below* it, so varying label widths never unbalance the spacing.
 *    Connector lines join adjacent circles. Completed steps show a check and
 *    are clickable (jump back); the active step carries `aria-current="step"`.
 *  - **< sm**: a compact filled progress bar + "current / total" and the active
 *    step's label — no per-step chrome that would overflow a phone width.
 *
 * Purely presentational — all navigation goes through the wizard context.
 */
export function WizardProgress({ ariaLabel, className }: WizardProgressProps) {
  const { steps, activeIndex, activeStep, maxVisitedIndex, goTo } = useWizard();
  const total = steps.length;
  const pct = total > 0 ? ((activeIndex + 1) / total) * 100 : 0;

  return (
    <div className={className}>
      {/* ── Mobile: progress bar ───────────────────────────────────── */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-fg-base min-w-0 truncate font-medium">
            {activeStep?.label}
          </span>
          <span className="text-fg-muted shrink-0 tabular-nums">
            {activeIndex + 1} / {total}
          </span>
        </div>
        <div
          className="bg-bg-elevated ring-border-strong h-1.5 overflow-hidden rounded-full ring-1"
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={activeIndex + 1}
        >
          <div
            className="bg-accent-base h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* ── ≥ sm: numbered steps ───────────────────────────────────── */}
      <ol
        role="list"
        aria-label={ariaLabel}
        className="hidden items-start sm:flex"
      >
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isComplete = index < activeIndex;
          const isReachable = index <= maxVisitedIndex && !isActive;
          const isFirst = index === 0;
          const isLast = index === total - 1;

          return (
            <li
              key={step.id}
              className="flex min-w-0 flex-1 flex-col items-center"
            >
              <div className="flex w-full items-center">
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-px flex-1',
                    isFirst
                      ? 'bg-transparent'
                      : isComplete || isActive
                        ? 'bg-accent-base/40'
                        : 'bg-border-strong',
                  )}
                />
                <button
                  type="button"
                  onClick={() => isReachable && goTo(index)}
                  disabled={!isReachable}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={step.label}
                  className={cn(
                    'focus-visible:ring-ring flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    isActive && 'bg-accent-base text-accent-fg',
                    isComplete && 'bg-accent-base/15 text-accent-base',
                    !isActive &&
                      !isComplete &&
                      'bg-bg-elevated text-fg-muted ring-border-strong ring-1',
                    isReachable && 'cursor-pointer hover:opacity-80',
                  )}
                >
                  {isComplete ? <Check className="size-3.5" /> : index + 1}
                </button>
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-px flex-1',
                    isLast
                      ? 'bg-transparent'
                      : isComplete
                        ? 'bg-accent-base/40'
                        : 'bg-border-strong',
                  )}
                />
              </div>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-2 max-w-full truncate px-1 text-xs',
                  isActive ? 'text-fg-base font-medium' : 'text-fg-muted',
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
