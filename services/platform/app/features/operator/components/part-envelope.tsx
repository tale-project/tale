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

import { usePackLabel } from '@/app/features/apps/runtime/app-runtime';
import { useT } from '@/lib/i18n/client';
import type { PartState } from '@/lib/shared/platform/part_state';
import { cn } from '@/lib/utils/cn';

import type { RenderPart } from '../types';

type BadgeVariant =
  | 'slate'
  | 'blue'
  | 'green'
  | 'destructive'
  | 'yellow'
  | 'orange';

const STATE_BADGE: Record<PartState, BadgeVariant> = {
  upcoming: 'slate',
  loading: 'slate',
  running: 'blue',
  output_available: 'green',
  output_error: 'destructive',
  waiting_human: 'yellow',
  waiting_external: 'orange',
  empty: 'slate',
};

// States whose own affordance replaces the panel body (nothing useful to show).
// `upcoming` is a quiet preview row (no skeleton); `loading` is the imminent step.
const BODY_SUPPRESSED = new Set<PartState>([
  'upcoming',
  'loading',
  'waiting_external',
  'empty',
]);

export function PartEnvelope({
  part,
  children,
}: {
  part: RenderPart;
  children: ReactNode;
}) {
  const { t } = useT('operator');
  const packLabel = usePackLabel();
  // Pack-authored Tier-2 label wins; the operator structural i18n key (or the
  // raw step name) is the fallback — parity with the Overview map.
  const title = packLabel(
    part.labelKey,
    part.labelKey ? t(part.labelKey, { defaultValue: part.title }) : part.title,
  );
  const showBody = !BODY_SUPPRESSED.has(part.partState);
  const isGate = part.treatment === 'gate';

  return (
    <Card className={cn(isGate && 'bg-muted/30')}>
      <VStack gap={3}>
        <HStack gap={2} className="flex-wrap items-center justify-between">
          <HStack gap={2} className="min-w-0 flex-wrap items-center">
            <Text
              as="span"
              className={cn('font-medium', isGate && 'text-muted-foreground')}
              truncate
            >
              {title}
            </Text>
            {isGate && (
              <Badge variant="outline">
                {t('gate', { defaultValue: 'Decision' })}
              </Badge>
            )}
            {part.stage && (
              <Badge variant="slate">
                {t(`stage.${part.stage}`, { defaultValue: part.stage })}
              </Badge>
            )}
            {part.role && <Badge variant="outline">{part.role}</Badge>}
          </HStack>
          <Badge variant={STATE_BADGE[part.partState]} dot>
            {t(`state.${part.partState}`)}
          </Badge>
        </HStack>

        {part.partState === 'loading' && <SkeletonText lines={2} />}

        {part.partState === 'waiting_external' && (
          <Text variant="muted">{t('body.waitingExternal')}</Text>
        )}

        {part.partState === 'empty' && (
          <Text variant="muted">{t('body.empty')}</Text>
        )}

        {part.partState === 'output_error' && part.error && (
          <Text variant="muted" className="text-destructive">
            {part.error}
          </Text>
        )}

        {showBody && children}
      </VStack>
    </Card>
  );
}
