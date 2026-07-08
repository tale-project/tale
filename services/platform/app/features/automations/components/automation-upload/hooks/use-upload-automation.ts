import { useCallback, useState } from 'react';

import type { ParsedAutomationBundle } from '../utils/parse-automation-bundle';

export type AutomationUploadStep = 'upload' | 'preview';

const STEP_ORDER: AutomationUploadStep[] = ['upload', 'preview'];

interface UploadAutomationState {
  step: AutomationUploadStep;
  parsedBundle: ParsedAutomationBundle | null;
  isSubmitting: boolean;
}

export function useUploadAutomation() {
  const [state, setState] = useState<UploadAutomationState>({
    step: 'upload',
    parsedBundle: null,
    isSubmitting: false,
  });

  const setParsedBundle = useCallback((bundle: ParsedAutomationBundle) => {
    setState((prev) => ({ ...prev, parsedBundle: bundle, step: 'preview' }));
  }, []);

  const setIsSubmitting = useCallback((submitting: boolean) => {
    setState((prev) => ({ ...prev, isSubmitting: submitting }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      const idx = STEP_ORDER.indexOf(prev.step);
      if (idx > 0) return { ...prev, step: STEP_ORDER[idx - 1] };
      return prev;
    });
  }, []);

  const reset = useCallback(() => {
    setState({ step: 'upload', parsedBundle: null, isSubmitting: false });
  }, []);

  return {
    ...state,
    setParsedBundle,
    setIsSubmitting,
    goBack,
    reset,
  };
}
