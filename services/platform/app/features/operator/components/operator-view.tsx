'use client';

/** The domain projection: the stage-timeline header + one render-kind panel per
 * step, each wrapped in the lifecycle part envelope. Pure data → generic
 * renderer; no per-vertical code. */
import { VStack } from '@tale/ui/layout';

import { type OperatorProjection, stepToPart } from '../types';
import { PartEnvelope } from './part-envelope';
import { RenderKindRouter } from './render-kind-router';
import { StageTimeline } from './stage-timeline';

export function OperatorView({
  projection,
}: {
  projection: OperatorProjection;
}) {
  return (
    <VStack gap={4}>
      <StageTimeline projection={projection} />
      <VStack gap={3}>
        {projection.steps.map((step) => {
          const part = stepToPart(step);
          return (
            <PartEnvelope key={step.stepSlug} part={part}>
              <RenderKindRouter part={part} />
            </PartEnvelope>
          );
        })}
      </VStack>
    </VStack>
  );
}
