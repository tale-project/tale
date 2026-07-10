'use client';

/** The domain projection: Outcome always expanded as a peer of Input, then
 * waiting_human steps, then Run details (timeline + process) collapsed by
 * default. Pure data → generic renderer; no per-vertical code. */
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import { type OperatorProjection, stepToPart } from '../types';
import { OutcomeStrip } from './outcome-strip';
import { PartEnvelope } from './part-envelope';
import { RenderKindRouter } from './render-kind-router';
import { StageTimeline } from './stage-timeline';

export function OperatorView({
  projection,
}: {
  projection: OperatorProjection;
}) {
  const { t } = useT('operator');
  const waitingHuman = projection.steps.filter(
    (s) => s.partState === 'waiting_human',
  );
  const processSteps = projection.steps.filter(
    (s) => s.partState !== 'waiting_human',
  );

  const renderStep = (
    step: (typeof projection.steps)[number],
    forceExpanded = false,
  ) => {
    const part = stepToPart(step);
    return (
      <PartEnvelope
        key={step.stepSlug}
        part={part}
        forceExpanded={forceExpanded}
      >
        <RenderKindRouter part={part} />
      </PartEnvelope>
    );
  };

  const hasProcess = processSteps.length > 0 || projection.stages.length > 0;

  return (
    <VStack gap={4}>
      {/* Always expanded when present — peer of Input in the detail overlay. */}
      <OutcomeStrip projection={projection} />
      {waitingHuman.map((step) => renderStep(step, true))}
      {hasProcess ? (
        <CollapsibleDetails
          summary={
            <Text as="span" className="font-medium">
              {t('section.runDetails', { defaultValue: 'Run details' })}
            </Text>
          }
        >
          <VStack gap={3} className="mt-3">
            <StageTimeline projection={projection} />
            {processSteps.map((step) => renderStep(step))}
          </VStack>
        </CollapsibleDetails>
      ) : null}
    </VStack>
  );
}
