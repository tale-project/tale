'use client';

/**
 * The shared part envelope: renders the orthogonal lifecycle `state` axis around
 * EVERY render-kind panel — title + stage/role chips + a state badge, then the
 * body gated on the state. Because lifecycle is modeled once here, the would-be
 * error / empty / waiting render-kinds need no dedicated component.
 *
 * Collapse is three-state: `auto` follows partState defaults; a user click
 * locks open or closed until remount. `waiting_human` always expands under auto
 * (and when `forceExpanded` is set by the shell).
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { Bot, ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

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
  skipped: 'slate',
  loading: 'slate',
  running: 'blue',
  queued_capacity: 'orange',
  output_available: 'green',
  output_error: 'destructive',
  waiting_human: 'yellow',
  waiting_external: 'orange',
  empty: 'slate',
};

/** Default expand under `auto` — full partState table. */
const AUTO_EXPANDED: Record<PartState, boolean> = {
  running: true,
  loading: true,
  waiting_human: true,
  waiting_external: true,
  queued_capacity: true,
  output_error: true,
  output_available: false,
  skipped: false,
  upcoming: false,
  empty: false,
};

// States whose own affordance replaces the panel body (nothing useful to show).
const BODY_SUPPRESSED = new Set<PartState>([
  'upcoming',
  'skipped',
  'loading',
  'queued_capacity',
  'waiting_external',
  'empty',
  'output_error',
]);

type CollapseOverride = 'auto' | 'open' | 'closed';

export function PartEnvelope({
  part,
  children,
  forceExpanded = false,
}: {
  part: RenderPart;
  children: ReactNode;
  /** Shell pin — e.g. waiting_human must stay visible outside a collapsed Steps block. */
  forceExpanded?: boolean;
}) {
  const { t } = useT('operator');
  const { t: tAutomations } = useT('automations');
  const [override, setOverride] = useState<CollapseOverride>('auto');
  const title = part.labelKey
    ? tAutomations(part.labelKey, { defaultValue: part.title })
    : part.title;
  const showBody = !BODY_SUPPRESSED.has(part.partState);
  const isGate = part.treatment === 'gate';

  const hasBody =
    showBody ||
    part.partState === 'loading' ||
    part.partState === 'queued_capacity' ||
    part.partState === 'waiting_external' ||
    part.partState === 'empty' ||
    (part.partState === 'output_error' && part.error !== undefined);

  const autoOpen = AUTO_EXPANDED[part.partState];
  const open =
    forceExpanded || (override === 'auto' ? autoOpen : override === 'open');

  const titleCluster = (
    <>
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
      {part.role && (
        <Badge variant="outline" icon={Bot}>
          {part.role}
        </Badge>
      )}
    </>
  );

  return (
    <Card className={cn(isGate && 'bg-bg-muted/30')}>
      <VStack gap={3}>
        <HStack gap={2} className="flex-wrap items-center justify-between">
          {hasBody ? (
            <button
              type="button"
              onClick={() => {
                // User gesture always wins over auto; toggle relative to what
                // is currently shown (including forceExpanded / auto).
                setOverride(open ? 'closed' : 'open');
              }}
              aria-expanded={open}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
            >
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 transition-transform',
                  !open && '-rotate-90',
                )}
                aria-hidden
              />
              {titleCluster}
            </button>
          ) : (
            <HStack gap={2} className="min-w-0 flex-wrap items-center">
              {titleCluster}
            </HStack>
          )}
          <Badge variant={STATE_BADGE[part.partState]} dot>
            {t(`state.${part.partState}`)}
          </Badge>
        </HStack>

        {open && (
          <>
            {part.partState === 'loading' && <SkeletonText lines={2} />}

            {part.partState === 'queued_capacity' && (
              <Text variant="muted">{t('body.queuedCapacity')}</Text>
            )}

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
          </>
        )}
      </VStack>
    </Card>
  );
}
