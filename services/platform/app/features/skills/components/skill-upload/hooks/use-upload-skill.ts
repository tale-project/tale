import { useState, useCallback } from 'react';

import type { ParsedSkillBundle } from '../utils/parse-skill-bundle';

export type UploadStep = 'upload' | 'preview';

const STEP_ORDER: UploadStep[] = ['upload', 'preview'];

interface UploadSkillState {
  step: UploadStep;
  parsedBundle: ParsedSkillBundle | null;
  isSubmitting: boolean;
}

export function useUploadSkill() {
  const [state, setState] = useState<UploadSkillState>({
    step: 'upload',
    parsedBundle: null,
    isSubmitting: false,
  });

  const setParsedBundle = useCallback((bundle: ParsedSkillBundle) => {
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
