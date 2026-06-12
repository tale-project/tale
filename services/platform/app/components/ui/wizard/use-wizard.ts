'use client';

import { createContext, useContext } from 'react';

/** One step in a wizard. `label` is already translated by the caller. */
export interface WizardStepMeta {
  id: string;
  label: string;
  /** Optional steps render a Skip action and can be advanced without validity. */
  optional?: boolean;
}

export type WizardStatus = 'idle' | 'submitting';

/**
 * Advance gate a step may register. Runs when the user clicks Next/Finish on
 * that step; returning `false` (or throwing) keeps the user on the step — used
 * for "create the org" / "save the provider" before moving on.
 */
export type WizardBeforeNext = () => boolean | Promise<boolean>;

export interface WizardContextValue {
  steps: WizardStepMeta[];
  activeIndex: number;
  activeStep: WizardStepMeta;
  isFirst: boolean;
  isLast: boolean;
  status: WizardStatus;
  /** Highest index reached — gates `goTo` so users can't skip ahead. */
  maxVisitedIndex: number;
  goNext: () => void;
  goBack: () => void;
  goTo: (index: number) => void;
  skip: () => void;
  /** Steps report their own validity; Next is disabled while the active step is invalid. */
  setStepValid: (id: string, valid: boolean) => void;
  setStepBeforeNext: (
    id: string,
    handler: WizardBeforeNext | undefined,
  ) => void;
  isStepValid: (id: string) => boolean;
}

export const WizardContext = createContext<WizardContextValue | null>(null);

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (ctx === null) {
    throw new Error('useWizard must be used within a <Wizard>');
  }
  return ctx;
}
