import { useState, useCallback } from 'react';

import type { ParsedPackage } from '../utils/parse-integration-package';

export type UploadStep = 'upload' | 'preview';

const STEP_ORDER: UploadStep[] = ['upload', 'preview'];

interface UploadIntegrationState {
  step: UploadStep;
  parsedPackage: ParsedPackage | null;
  isCreating: boolean;
}

export function useUploadIntegration() {
  const [state, setState] = useState<UploadIntegrationState>({
    step: 'upload',
    parsedPackage: null,
    isCreating: false,
  });

  const setParsedPackage = useCallback((pkg: ParsedPackage) => {
    setState((prev) => ({
      ...prev,
      parsedPackage: pkg,
      step: 'preview',
    }));
  }, []);

  const setIsCreating = useCallback((creating: boolean) => {
    setState((prev) => ({ ...prev, isCreating: creating }));
  }, []);

  const goBack = useCallback(() => {
    setState((prev) => {
      const currentIndex = STEP_ORDER.indexOf(prev.step);
      if (currentIndex > 0) {
        return { ...prev, step: STEP_ORDER[currentIndex - 1] };
      }
      return prev;
    });
  }, []);

  const setIconFile = useCallback((iconFile: File | undefined) => {
    setState((prev) => {
      if (!prev.parsedPackage) return prev;
      return {
        ...prev,
        parsedPackage: { ...prev.parsedPackage, iconFile },
      };
    });
  }, []);

  const reset = useCallback(() => {
    setState({
      step: 'upload',
      parsedPackage: null,
      isCreating: false,
    });
  }, []);

  const stepIndex = STEP_ORDER.indexOf(state.step);

  return {
    ...state,
    stepIndex,
    totalSteps: STEP_ORDER.length,
    setParsedPackage,
    setIsCreating,
    setIconFile,
    goBack,
    reset,
  };
}
