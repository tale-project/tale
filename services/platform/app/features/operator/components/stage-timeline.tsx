'use client';

/** The run-view topology header: the workflow's STAGES in order with the live
 * position highlighted. Topology lives here in the shell (plan / progress), NOT
 * as a per-step render-kind — that would be a layer violation. */
import { Badge } from '@tale/ui/badge';
import { HStack } from '@tale/ui/layout';

import { useT } from '@/lib/i18n/client';

import type { OperatorProjection } from '../types';

export function StageTimeline({
  projection,
}: {
  projection: OperatorProjection;
}) {
  const { t } = useT('operator');
  if (projection.stages.length === 0) return null;

  const currentStage = projection.steps.find(
    (s) => s.stepSlug === projection.currentStepSlug,
  )?.stage;

  return (
    <HStack gap={2} className="flex-wrap items-center">
      {projection.stages.map((stage, i) => (
        <HStack key={stage} gap={2} className="items-center">
          <Badge variant={stage === currentStage ? 'blue' : 'slate'}>
            {t(`stage.${stage}`, { defaultValue: stage })}
          </Badge>
          {i < projection.stages.length - 1 && (
            <span className="text-muted-foreground">→</span>
          )}
        </HStack>
      ))}
    </HStack>
  );
}
