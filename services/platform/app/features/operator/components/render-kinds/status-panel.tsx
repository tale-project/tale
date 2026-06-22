'use client';

/** `status` — the generic step summary (also the graceful-degradation fallback
 * for unannotated/unknown render kinds). Lifecycle rides the part envelope.
 * A `gate` step surfaces its scalar verdict (e.g. `"yes"`/`"no"`) as a clear
 * badge; any other status step has no detail to show (low-value run metadata
 * like attempts / duration is intentionally omitted), so it renders an explicit
 * placeholder rather than an empty expanded body. */
import { Badge } from '@tale/ui/badge';
import { HStack, VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import { usePackLabel } from '@/app/features/apps/runtime/app-runtime';
import { useT } from '@/lib/i18n/client';

import type { RenderPart } from '../../types';

export function StatusPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const packLabel = usePackLabel();

  // A gate step's scalar output IS the decision — surface it as a verdict badge.
  const verdict =
    part.treatment === 'gate' && typeof part.data === 'string'
      ? part.data.trim()
      : '';

  // No verdict → nothing meaningful to show; render a clear placeholder so an
  // expanded step never looks broken/empty.
  if (verdict === '') {
    return <Text variant="muted">{t('body.noDetails')}</Text>;
  }

  // Affirmative ("…yes…") reads green; anything else reads needs-work yellow.
  // The text resolves through the pack's `verdictLabels` map, then the operator
  // catalog, then the raw value.
  const key = verdict.toLowerCase();
  const affirmative = key.includes('yes');
  const label = packLabel(
    part.params?.verdictLabels?.[key],
    t(`verdict.${key}`, { defaultValue: verdict }),
  );

  return (
    <VStack gap={3}>
      <HStack>
        <Badge variant={affirmative ? 'green' : 'yellow'} dot>
          {label}
        </Badge>
      </HStack>
    </VStack>
  );
}
