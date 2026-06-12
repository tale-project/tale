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
 * Numbered step indicator. Completed steps show a check and are clickable
 * (jump back); the active step carries `aria-current="step"`; future steps are
 * inert. Purely presentational — all navigation goes through the context.
 */
export function WizardProgress({ ariaLabel, className }: WizardProgressProps) {
  const { steps, activeIndex, maxVisitedIndex, goTo } = useWizard();

  return (
    <ol
      aria-label={ariaLabel}
      className={cn('flex items-center gap-2', className)}
    >
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        const isComplete = index < activeIndex;
        const isReachable = index <= maxVisitedIndex && index !== activeIndex;

        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => isReachable && goTo(index)}
              disabled={!isReachable}
              aria-current={isActive ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isReachable && 'cursor-pointer hover:opacity-80',
                !isReachable && !isActive && 'cursor-default',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                  isActive && 'bg-accent-base text-accent-fg',
                  isComplete && 'bg-accent-base/15 text-accent-base',
                  !isActive &&
                    !isComplete &&
                    'bg-bg-elevated text-fg-muted ring-1 ring-border-strong',
                )}
              >
                {isComplete ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  'truncate',
                  isActive ? 'text-fg-base font-medium' : 'text-fg-muted',
                )}
              >
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className="bg-border-strong h-px flex-1"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
