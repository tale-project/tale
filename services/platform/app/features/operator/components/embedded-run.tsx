'use client';

/**
 * Route-free, reusable execution view — the operator render-kind panels
 * (stage timeline + per-step transcript / gate / artifact / summary.md, live
 * agent transcript included) for one execution, embeddable inside ANY domain
 * component (a task card/detail now; other components later). This is the only
 * justification for the step `ui` config / render-kinds: how a step renders when
 * fused into a domain surface. Given just `{organizationId, executionId}`.
 */
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';

import { useExecutionProjection } from '../hooks/use-execution-projection';
import { OperatorView } from './operator-view';

export function EmbeddedRun({
  organizationId,
  executionId,
}: {
  organizationId: string;
  executionId: string;
}) {
  const { projection, isLoading, error } = useExecutionProjection({
    organizationId,
    executionId,
  });

  if (error) return <Text variant="error">{error.message}</Text>;
  if (!projection) return isLoading ? <SkeletonText lines={4} /> : null;
  return <OperatorView projection={projection} />;
}
