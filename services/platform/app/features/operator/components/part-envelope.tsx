'use client';

/**
 * The shared part envelope: renders the orthogonal lifecycle `state` axis around
 * EVERY render-kind panel — title + stage/role chips + a state badge, then the
 * body gated on the state. Because lifecycle is modeled once here, the would-be
 * error / empty / waiting render-kinds need no dedicated component.
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';
import type { PartState } from '@/lib/shared/platform/part_state';

import type { StepProjection } from '../types';

type BadgeVariant =
  | 'slate'
  | 'blue'
  | 'green'
  | 'destructive'
  | 'yellow'
  | 'orange';

const STATE_BADGE: Record<PartState, BadgeVariant> = {
  loading: 'slate',
  running: 'blue',
  output_available: 'green',
  output_error: 'destructive',
  waiting_human: 'yellow',
  waiting_external: 'orange',
  empty: 'slate',
};

// States whose own affordance replaces the panel body (nothing useful to show).
const BODY_SUPPRESSED = new Set<PartState>([
  'loading',
  'waiting_external',
  'empty',
]);

export function PartEnvelope({
  step,
  children,
}: {
  step: StepProjection;
  children: ReactNode;
}) {
  const { t } = useT('operator');
  const title = step.labelKey
    ? t(step.labelKey, { defaultValue: step.name })
    : step.name;
  const showBody = !BODY_SUPPRESSED.has(step.partState);

  return (
    <Card>
      <VStack gap={3}>
        <HStack gap={2} className="flex-wrap items-center justify-between">
          <HStack gap={2} className="min-w-0 flex-wrap items-center">
            <Text as="span" className="font-medium" truncate>
              {title}
            </Text>
            {step.stage && (
              <Badge variant="slate">
                {t(`stage.${step.stage}`, { defaultValue: step.stage })}
              </Badge>
            )}
            {step.role && <Badge variant="outline">{step.role}</Badge>}
          </HStack>
          <Badge variant={STATE_BADGE[step.partState]} dot>
            {t(`state.${step.partState}`)}
          </Badge>
        </HStack>

        {step.partState === 'loading' && <SkeletonText lines={2} />}

        {step.partState === 'waiting_external' && (
          <Text variant="muted">{t('body.waitingExternal')}</Text>
        )}

        {step.partState === 'empty' && (
          <Text variant="muted">{t('body.empty')}</Text>
        )}

        {step.partState === 'output_error' && step.node?.error && (
          <Text variant="muted" className="text-destructive">
            {step.node.error}
          </Text>
        )}

        {showBody && children}
      </VStack>
    </Card>
  );
}
