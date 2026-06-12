'use client';

import { Button } from '@tale/ui/button';

import { cn } from '@/lib/utils/cn';

import { useWizard } from './use-wizard';

export interface WizardFooterProps {
  /** All labels are translated by the caller. */
  backLabel: string;
  nextLabel: string;
  finishLabel: string;
  /** Required only when any step is optional (renders the Skip action). */
  skipLabel?: string;
  className?: string;
}

/**
 * Back / Skip / Next-or-Finish controls wired to the wizard context. Next is
 * disabled while the active step is invalid or a step transition is running;
 * the last step shows Finish; Skip appears only on optional steps.
 */
export function WizardFooter({
  backLabel,
  nextLabel,
  finishLabel,
  skipLabel,
  className,
}: WizardFooterProps) {
  const {
    activeStep,
    isFirst,
    isLast,
    status,
    goBack,
    goNext,
    skip,
    isStepValid,
  } = useWizard();

  const submitting = status === 'submitting';
  const nextDisabled = !activeStep || !isStepValid(activeStep.id) || submitting;
  const showSkip = Boolean(activeStep?.optional && skipLabel);

  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <div>
        {!isFirst && (
          <Button variant="ghost" onClick={goBack} disabled={submitting}>
            {backLabel}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showSkip && (
          <Button variant="ghost" onClick={skip} disabled={submitting}>
            {skipLabel}
          </Button>
        )}
        <Button onClick={goNext} disabled={nextDisabled} isLoading={submitting}>
          {isLast ? finishLabel : nextLabel}
        </Button>
      </div>
    </div>
  );
}
