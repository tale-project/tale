'use client';

/** `status` — the generic step summary (also the graceful-degradation fallback
 * for unannotated/unknown render kinds). Lifecycle rides the part envelope. */
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import type { RenderPart } from '../../types';
import { KvGrid, type KvRow } from '../kv-grid';

export function StatusPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const rows: KvRow[] = [];
  if (part.meta?.attempts) {
    rows.push({
      label: t('field.attempts'),
      value: String(part.meta.attempts),
    });
  }
  if (part.meta?.startedAt && part.meta?.completedAt) {
    rows.push({
      label: t('field.duration'),
      value: `${part.meta.completedAt - part.meta.startedAt} ms`,
    });
  }
  return rows.length > 0 ? (
    <KvGrid rows={rows} />
  ) : (
    <Text variant="muted">{t('body.noDetails')}</Text>
  );
}
