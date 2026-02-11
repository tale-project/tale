import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useDebounce } from '@/app/hooks/use-debounce';
import { api } from '@/convex/_generated/api';

export function useListWorkflowVersions(
  organizationId: string | undefined,
  name: string | undefined,
) {
  return useConvexQuery(
    api.wf_definitions.queries.listVersions,
    organizationId && name ? { organizationId, name } : 'skip',
  );
}

export function useWorkflowSteps(wfDefinitionId: Id<'wfDefinitions'>) {
  return useConvexQuery(api.wf_step_defs.queries.getWorkflowSteps, {
    wfDefinitionId,
  });
}

export function useExecutionJournal(
  executionId: Id<'wfExecutions'> | undefined,
) {
  return useConvexQuery(
    api.wf_executions.queries.getExecutionStepJournal,
    executionId ? { executionId } : 'skip',
  );
}

interface ListExecutionsArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  searchTerm?: string;
  status?: string[];
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  numItems: number;
}

export function useListExecutions(args: ListExecutionsArgs) {
  return useConvexQuery(api.wf_executions.queries.listExecutionsCursor, args);
}

export function useDryRunWorkflow(
  wfDefinitionId: Id<'wfDefinitions'>,
  input: Record<string, unknown> | null,
  enabled: boolean,
) {
  return useConvexQuery(
    api.wf_definitions.queries.dryRunWorkflow,
    enabled && input ? { wfDefinitionId, input } : 'skip',
  );
}

export function useWorkflow(wfDefinitionId: Id<'wfDefinitions'> | undefined) {
  return useConvexQuery(
    api.wf_definitions.queries.getWorkflow,
    wfDefinitionId ? { wfDefinitionId } : 'skip',
  );
}

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

  const { data: validationResult, isLoading } = useConvexQuery(
    api.wf_step_defs.queries.validateStep,
    stableConfig
      ? {
          stepConfig: stableConfig,
          wfDefinitionId,
        }
      : 'skip',
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
