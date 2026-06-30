import { useCallback, useState } from 'react';

import type { ParsedAppBundle } from '../utils/parse-app-bundle';

export type AppUploadStep = 'upload' | 'preview';

const STEP_ORDER: AppUploadStep[] = ['upload', 'preview'];

interface UploadAppState {
  step: AppUploadStep;
  parsedBundle: ParsedAppBundle | null;
  isSubmitting: boolean;
}

export function useUploadApp() {
  const [state, setState] = useState<UploadAppState>({
    step: 'upload',
    parsedBundle: null,
    isSubmitting: false,
  });

  const setParsedBundle = useCallback((bundle: ParsedAppBundle) => {
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
