'use client';

/** `status` — the generic step summary (also the graceful-degradation fallback
 * for unannotated/unknown render kinds). Lifecycle rides the part envelope. */
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';

import type { StepProjection } from '../../types';
import { KvGrid, type KvRow } from '../kv-grid';

export function StatusPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const rows: KvRow[] = [{ label: t('field.stepType'), value: step.stepType }];
  if (step.node?.attempts) {
    rows.push({
      label: t('field.attempts'),
      value: String(step.node.attempts),
    });
  }
  if (step.node?.startedAt && step.node?.completedAt) {
    rows.push({
      label: t('field.duration'),
      value: `${step.node.completedAt - step.node.startedAt} ms`,
    });
  }
  return rows.length > 1 || step.node ? (
    <KvGrid rows={rows} />
  ) : (
    <Text variant="muted">{t('body.noDetails')}</Text>
  );
}
