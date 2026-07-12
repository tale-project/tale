'use client';

import { useMemo } from 'react';

import { useReadWorkflow } from '../../hooks/file-queries';
import type { InputSchema } from '../../utils/input-schema-template';

/**
 * The workflow's start-step `inputSchema`, when it declares one — the same
 * extraction the schedule create/edit dialog needs, factored so the
 * schedule LIST (needs-configuration badge, #2613) reads the identical
 * schema instead of a second copy of this lookup.
 */
export function useWorkflowInputSchema(
  organizationId: string,
  workflowSlug: string,
): InputSchema | undefined {
  const { data: workflowRead } = useReadWorkflow(organizationId, workflowSlug);

  return useMemo(() => {
    if (!workflowRead?.ok) return undefined;
    const startStep = workflowRead.config.steps?.find(
      (s) => s.stepType === 'start',
    );
    const startConfig = startStep?.config as
      | { inputSchema?: InputSchema }
      | undefined;
    return startConfig?.inputSchema;
  }, [workflowRead]);
}
