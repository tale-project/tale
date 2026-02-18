import { useMemo } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import type { ConvexItemOf } from '@/lib/types/convex-helpers';

import { useCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useDebounce } from '@/app/hooks/use-debounce';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';

export type AutomationRoot = ConvexItemOf<
  typeof api.wf_definitions.queries.listAutomationRoots
>;

export type WfAutomation = ConvexItemOf<
  typeof api.wf_definitions.queries.listAutomations
>;

export type WfStep = ConvexItemOf<
  typeof api.wf_step_defs.queries.getWorkflowSteps
>;

export function useApproxAutomationCount(organizationId: string) {
  return useConvexQuery(api.wf_definitions.queries.approxCountAutomations, {
    organizationId,
  });
}

export function useAutomationRoots(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.wf_definitions.queries.listAutomationRoots,
    { organizationId },
  );

  return {
    automationRoots: data ?? [],
    isLoading,
  };
}

export function useAutomations(organizationId: string) {
  const { data, isLoading } = useConvexQuery(
    api.wf_definitions.queries.listAutomations,
    { organizationId },
  );

  return {
    automations: data ?? [],
    isLoading,
  };
}

export function useWorkflowSteps(wfDefinitionId: string) {
  const { data, isLoading } = useConvexQuery(
    api.wf_step_defs.queries.getWorkflowSteps,
    { wfDefinitionId: toId<'wfDefinitions'>(wfDefinitionId) },
  );

  return {
    steps: data ?? [],
    isLoading,
  };
}

export function useListWorkflowVersions(
  organizationId: string | undefined,
  name: string | undefined,
) {
  return useConvexQuery(
    api.wf_definitions.queries.listVersions,
    organizationId && name ? { organizationId, name } : 'skip',
  );
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
  status?: string[];
  triggeredBy?: string;
  dateFrom?: string;
  dateTo?: string;
  initialNumItems: number;
}

export function useListExecutions(args: ListExecutionsArgs | 'skip') {
  const queryArgs =
    args === 'skip'
      ? 'skip'
      : (() => {
          const { initialNumItems: _, ...rest } = args;
          return rest;
        })();
  const initialNumItems = args === 'skip' ? 10 : args.initialNumItems;

  return useCachedPaginatedQuery(
    api.wf_executions.queries.listExecutions,
    queryArgs,
    { initialNumItems },
  );
}

interface SearchExecutionArgs {
  wfDefinitionId: Id<'wfDefinitions'>;
  searchTerm: string;
  numItems: number;
}

export function useSearchExecution(args: SearchExecutionArgs | undefined) {
  return useConvexQuery(
    api.wf_executions.queries.listExecutionsCursor,
    args ? { ...args, cursor: undefined } : 'skip',
  );
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
