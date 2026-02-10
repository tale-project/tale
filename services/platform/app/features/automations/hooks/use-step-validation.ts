/**
 * Hook for validating workflow step configuration
 *
 * Provides debounced validation with loading and error states.
 */

import { convexQuery } from '@convex-dev/react-query';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useDebounce } from '@/app/hooks/use-debounce';
import { api } from '@/convex/_generated/api';

interface StepConfig {
  stepSlug?: string;
  name?: string;
  stepType?: string;
  config?: unknown;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  isValidating: boolean;
}

export function useStepValidation(
  stepConfig: StepConfig | null,
  wfDefinitionId?: Id<'wfDefinitions'>,
  debounceMs = 300,
): ValidationResult {
  const debouncedConfig = useDebounce(stepConfig, debounceMs);

  const stableConfig = useMemo(() => {
    if (!debouncedConfig) return null;
    return {
      stepSlug: debouncedConfig.stepSlug,
      name: debouncedConfig.name,
      stepType: debouncedConfig.stepType,
      config: debouncedConfig.config,
    };
  }, [debouncedConfig]);

  const { data: validationResult, isLoading } = useQuery(
    convexQuery(
      api.wf_step_defs.queries.validateStep,
      stableConfig
        ? {
            stepConfig: stableConfig,
            wfDefinitionId,
          }
        : 'skip',
    ),
  );

  const isValidating = stableConfig !== null && isLoading;

  if (!stableConfig) {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      isValidating: false,
    };
  }

  return {
    isValid: isValidating ? false : (validationResult?.valid ?? false),
    errors: validationResult?.errors ?? [],
    warnings: validationResult?.warnings ?? [],
    isValidating,
  };
}
