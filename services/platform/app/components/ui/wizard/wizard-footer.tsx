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
  /**
   * Full-width, vertically-stacked layout: the primary Next/Finish button spans
   * the container width (matching form inputs), with Skip and Back as full-width
   * secondary buttons below. Use for narrow / onboarding flows. Default is the
   * horizontal Back-left / Next-right bar.
   */
  stacked?: boolean;
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
  stacked,
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
    activePrimary,
  } = useWizard();

  const submitting = status === 'submitting';
  const nextDisabled = !activeStep || !isStepValid(activeStep.id) || submitting;
  const showSkip = Boolean(activeStep?.optional && skipLabel);

  // The active step may override the primary label/emphasis (e.g. "Skip for
  // now" vs "Connect"); otherwise fall back to the standard Next/Finish label.
  const primaryLabel =
    activePrimary?.label ?? (isLast ? finishLabel : nextLabel);
  const primaryVariant =
    activePrimary?.variant === 'secondary' ? 'secondary' : undefined;

  if (stacked) {
    // Full-width primary action (matching the inputs). Back lives at the
    // top-left of the flow (rendered in the wizard header), so the footer only
    // carries the primary plus an optional, centered Skip beneath it.
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        <Button
          className="w-full"
          variant={primaryVariant}
          onClick={goNext}
          disabled={nextDisabled}
          isLoading={submitting}
        >
          {primaryLabel}
        </Button>
        {showSkip && (
          <Button
            variant="ghost"
            onClick={skip}
            disabled={submitting}
            className="mx-auto"
          >
            {skipLabel}
          </Button>
        )}
      </div>
    );
  }

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
        <Button
          variant={primaryVariant}
          onClick={goNext}
          disabled={nextDisabled}
          isLoading={submitting}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
