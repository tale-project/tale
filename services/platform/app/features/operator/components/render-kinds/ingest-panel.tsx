'use client';

/** `ingest` — a source / intake summary (item count + source reference). */
import { useT } from '@/lib/i18n/client';

import { asRecord, pickNumber, pickString } from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { KvGrid, type KvRow } from '../kv-grid';
import { OutputFallback } from '../output-fallback';

export function IngestPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const count = pickNumber(out, 'count', 'total', 'items', 'rows');
  const source = pickString(out, 'source', 'sourceRef', 'origin', 'url');

  const rows: KvRow[] = [];
  if (count !== undefined) {
    rows.push({ label: t('field.count'), value: String(count) });
  }
  if (source !== undefined)
    rows.push({ label: t('field.source'), value: source });

  return rows.length > 0 ? (
    <KvGrid rows={rows} />
  ) : (
    <OutputFallback step={step} />
  );
}
