'use client';

/**
 * The shared part envelope: renders the orthogonal lifecycle `state` axis around
 * EVERY render-kind panel — title + stage/role chips + a state badge, then the
 * body gated on the state. Because lifecycle is modeled once here, the would-be
 * error / empty / waiting render-kinds need no dedicated component.
 *
 * The header doubles as a per-step disclosure toggle: each step collapses/expands
 * independently (state lives per envelope instance, keyed by stepSlug upstream),
 * so a run with several long agent summaries stays scannable.
 */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { HStack, VStack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useState } from 'react';

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
// `upcoming` is a quiet preview row (no skeleton); `loading` is the imminent step;
// `output_error` shows its error message instead — a failed/canceled step has no
// meaningful result, and rendering the body would dump the abandoned step's raw
// output (e.g. a stopped sandbox step's `{status:'running'}` handoff envelope) as
// JSON, which must never surface.
const BODY_SUPPRESSED = new Set<PartState>([
  'upcoming',
  'loading',
  'waiting_external',
  'empty',
  'output_error',
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
  const [collapsed, setCollapsed] = useState(false);
  // Pack-authored Tier-2 label wins; the operator structural i18n key (or the
  // raw step name) is the fallback — parity with the Overview map.
  const title = packLabel(
    part.labelKey,
    part.labelKey ? t(part.labelKey, { defaultValue: part.title }) : part.title,
  );
  const showBody = !BODY_SUPPRESSED.has(part.partState);
  const isGate = part.treatment === 'gate';

  // Is there anything below the header to collapse? Only then show the toggle.
  const hasBody =
    showBody ||
    part.partState === 'loading' ||
    part.partState === 'waiting_external' ||
    part.partState === 'empty' ||
    (part.partState === 'output_error' && part.error !== undefined);
  const open = !collapsed;

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
      {part.stage && (
        <Badge variant="slate">
          {t(`stage.${part.stage}`, { defaultValue: part.stage })}
        </Badge>
      )}
      {part.role && <Badge variant="outline">{part.role}</Badge>}
    </>
  );

  return (
    <Card className={cn(isGate && 'bg-bg-muted/30')}>
      <VStack gap={3}>
        <HStack gap={2} className="flex-wrap items-center justify-between">
          {hasBody ? (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
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
