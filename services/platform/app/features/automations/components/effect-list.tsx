'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { Zap } from 'lucide-react';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import type { Effect } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

/**
 * The effects a run performed, in the order they happened.
 *
 * An effect is the auditable part of a run: it is the record that something
 * outside the platform changed. So each one is shown WHOLE — which node did it,
 * which connector it reached, and the exact input it was called with — rather
 * than counted or summarised. Someone asking "what did this automation actually
 * do last night" has to be able to read the answer, not infer it.
 */
export function EffectList({
  effects,
  emptyMessage,
  headingId,
}: {
  effects: readonly Effect[];
  emptyMessage: string;
  headingId?: string;
}) {
  const { t } = useT('automations');

  if (effects.length === 0) {
    return (
      <Text as="p" variant="muted" className="text-xs">
        {emptyMessage}
      </Text>
    );
  }

  return (
    <ol
      className="flex flex-col gap-2"
      {...(headingId !== undefined && { 'aria-labelledby': headingId })}
    >
      {effects.map((effect, index) => (
        <li
          // Effects are an ordered log: the same node may reach the same
          // connector many times, so position is the only stable identity.
          key={`${effect.node}-${effect.connector}-${String(index)}`}
          className="border-border bg-muted/40 rounded-md border p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="orange" icon={Zap}>
              {effect.connector}
            </Badge>
            <Text as="span" variant="muted" className="text-xs">
              {t('runs.effects.byNode', { node: effect.node })}
            </Text>
          </div>
          <div className="mt-2">
            <Text as="p" className="mb-1 text-xs font-medium">
              {t('runs.effects.inputLabel')}
            </Text>
            <JsonViewer data={effect.input} collapsed={1} />
          </div>
        </li>
      ))}
    </ol>
  );
}
