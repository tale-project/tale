'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

import { useWizard } from './use-wizard';

/** One cell of the numbered step rail: a real step, or a collapsed "…" gap. */
export type WizardRailItem =
  | { kind: 'step'; index: number }
  | { kind: 'ellipsis'; key: string };

/** Rails this length or shorter render every step; longer ones collapse to at
 *  most this many numbered circles + "…" gaps (owner ask: never show >4). */
export const RAIL_FULL_MAX = 4;

/**
 * Collapse a long step rail so at most ~4 numbered circles show at once:
 * always the first, last, and current step (plus the next, for context), with
 * each run of hidden steps replaced by a single "…". A rail of
 * {@link RAIL_FULL_MAX} steps or fewer renders in full. Presentational only —
 * navigation still targets the real step indices, so a collapsed step is never
 * unreachable (you reach it by advancing through the flow).
 */
export function windowWizardSteps(
  total: number,
  activeIndex: number,
): WizardRailItem[] {
  if (total <= RAIL_FULL_MAX) {
    return Array.from({ length: total }, (_, index) => ({
      kind: 'step' as const,
      index,
    }));
  }
  const shown = new Set<number>([0, total - 1, activeIndex]);
  // One step of look-ahead (or look-behind on the last step) for context.
  if (activeIndex + 1 < total) shown.add(activeIndex + 1);
  else if (activeIndex - 1 >= 0) shown.add(activeIndex - 1);

  const items: WizardRailItem[] = [];
  let i = 0;
  while (i < total) {
    if (shown.has(i)) {
      items.push({ kind: 'step', index: i });
      i += 1;
    } else {
      // Collapse the whole run of hidden steps into one ellipsis cell.
      let j = i;
      while (j < total && !shown.has(j)) j += 1;
      items.push({ kind: 'ellipsis', key: `gap-${i}` });
      i = j;
    }
  }
  return items;
}

export interface WizardProgressProps {
  /** Accessible name for the step list (translated by caller). */
  ariaLabel: string;
  className?: string;
  /**
   * Force the compact progress-bar layout at every breakpoint instead of the
   * numbered step rail on ≥sm. Use for narrow / onboarding flows where a
   * discrete "Step 1 of 3" indicator reads cleaner than a full step row.
   */
  compact?: boolean;
  /**
   * Optional formatter for the compact indicator's text line, e.g.
   * `(current, total, label) => "Step 1 of 3: Workspace"`. Falls back to the
   * active step's label plus "current / total".
   */
  formatStep?: (current: number, total: number, label: string) => string;
  /**
   * Minimal segmented bar: one pill per step, filled up to and including the
   * active step. No labels or numbers — position alone conveys progress. Use as
   * a clean, modern top-of-page indicator. Takes precedence over `compact`.
   */
  segmented?: boolean;
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
export function WizardProgress({
  ariaLabel,
  className,
  compact,
  formatStep,
  segmented,
}: WizardProgressProps) {
  const { steps, activeIndex, activeStep, maxVisitedIndex, goTo } = useWizard();
  const total = steps.length;
  const pct = total > 0 ? ((activeIndex + 1) / total) * 100 : 0;
  // Long rails collapse to first / current(+next) / last with "…" gaps so the
  // strip never grows too wide; short rails show every step.
  const railItems = windowWizardSteps(total, activeIndex);

  // ── Segmented bar: one pill per step, filled through the active step ────
  if (segmented) {
    return (
      <div
        className={cn('flex gap-1.5', className)}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={activeIndex + 1}
      >
        {steps.map((step, index) => (
          <span
            key={step.id}
            aria-hidden="true"
            className={cn(
              'h-1 flex-1 rounded-full transition-colors duration-300 ease-out motion-reduce:transition-none',
              index <= activeIndex ? 'bg-accent-base' : 'bg-border',
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* ── Compact progress bar (always when `compact`, else < sm) ──── */}
      <div className={cn('flex flex-col gap-2', !compact && 'sm:hidden')}>
        <div className="flex items-center justify-between gap-3 text-sm">
          {formatStep ? (
            <span className="text-fg-base min-w-0 truncate font-medium">
              {formatStep(activeIndex + 1, total, activeStep?.label ?? '')}
            </span>
          ) : (
            <>
              <span className="text-fg-base min-w-0 truncate font-medium">
                {activeStep?.label}
              </span>
              <span className="text-fg-muted shrink-0 tabular-nums">
                {activeIndex + 1} / {total}
              </span>
            </>
          )}
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

      {/* ── ≥ sm: numbered step rail (suppressed in compact mode) ──── */}
      {!compact && (
        <ol
          role="list"
          aria-label={ariaLabel}
          className="hidden items-start sm:flex"
        >
          {railItems.map((item, railIndex) => {
            const isFirstRail = railIndex === 0;
            const isLastRail = railIndex === railItems.length - 1;

            // A collapsed "…" cell — the same width/height as a step column so
            // the rail stays evenly distributed, but carries no button/label.
            if (item.kind === 'ellipsis') {
              return (
                <li
                  key={item.key}
                  className="flex min-w-0 flex-1 flex-col items-center"
                >
                  <div className="flex w-full items-center">
                    <span
                      aria-hidden="true"
                      className="bg-border-strong h-px flex-1"
                    />
                    <span
                      aria-hidden="true"
                      className="text-fg-muted flex size-7 shrink-0 items-center justify-center text-xs"
                    >
                      …
                    </span>
                    <span
                      aria-hidden="true"
                      className="bg-border-strong h-px flex-1"
                    />
                  </div>
                  {/* Blank label keeps the ellipsis column the same height as
                      the labelled step columns. */}
                  <span aria-hidden="true" className="mt-2 px-1 text-xs">
                    &#8203;
                  </span>
                </li>
              );
            }

            const { index } = item;
            const step = steps[index];
            if (!step) return null;
            const isActive = index === activeIndex;
            const isComplete = index < activeIndex;
            const isReachable = index <= maxVisitedIndex && !isActive;

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
                      isFirstRail
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
                      isLastRail
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
      )}
    </div>
  );
}
