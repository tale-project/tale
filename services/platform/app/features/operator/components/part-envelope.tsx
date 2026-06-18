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
import { isRecord } from '@/lib/utils/type-utils';

import type { RenderPart } from '../types';
import { ActionBar } from './action-bar';

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
  part,
  children,
}: {
  part: RenderPart;
  children: ReactNode;
}) {
  const { t } = useT('operator');
  const title = part.labelKey
    ? t(part.labelKey, { defaultValue: part.title })
    : part.title;
  const showBody = !BODY_SUPPRESSED.has(part.partState);

  return (
    <Card>
      <VStack gap={3}>
        <HStack gap={2} className="flex-wrap items-center justify-between">
          <HStack gap={2} className="min-w-0 flex-wrap items-center">
            <Text as="span" className="font-medium" truncate>
              {title}
            </Text>
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

        {/* Part-level actions (single-item parts). `collection` renders its own
            ROW actions; `review` carries its own approve/reject. */}
        {part.actions &&
          part.actions.length > 0 &&
          part.onAction &&
          part.render !== 'collection' &&
          part.render !== 'review' && (
            <ActionBar
              actions={part.actions}
              item={isRecord(part.data) ? part.data : {}}
              onAction={part.onAction}
              isPending={part.actionsPending}
            />
          )}
      </VStack>
    </Card>
  );
}
