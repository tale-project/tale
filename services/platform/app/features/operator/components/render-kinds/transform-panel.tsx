'use client';

/** `transform` — a processing-step summary (rows in/out, fields, timing). */
import { useT } from '@/lib/i18n/client';

import { asRecord, pickArray, pickNumber } from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { KvGrid, type KvRow } from '../kv-grid';
import { OutputFallback } from '../output-fallback';

export function TransformPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const rowsIn = pickNumber(out, 'rowsIn', 'inputRows', 'in');
  const rowsOut = pickNumber(out, 'rowsOut', 'outputRows', 'out');
  const fields = pickArray(out, 'fields', 'columns');

  const rows: KvRow[] = [];
  if (rowsIn !== undefined)
    rows.push({ label: t('field.rowsIn'), value: String(rowsIn) });
  if (rowsOut !== undefined)
    rows.push({ label: t('field.rowsOut'), value: String(rowsOut) });
  if (fields.length > 0) {
    rows.push({ label: t('field.fields'), value: String(fields.length) });
  }
  if (step.node?.startedAt && step.node?.completedAt) {
    rows.push({
      label: t('field.duration'),
      value: `${step.node.completedAt - step.node.startedAt} ms`,
    });
  }

  return rows.length > 0 ? (
    <KvGrid rows={rows} />
  ) : (
    <OutputFallback step={step} />
  );
}
