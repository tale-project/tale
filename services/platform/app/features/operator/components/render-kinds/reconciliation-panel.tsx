'use client';

import { VStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

/** `reconciliation` — match summary + ACTIONABLE adjudication. Shows matched /
 * unmatched counts and surfaces the unmatched items for resolution. (The
 * resolve action itself resumes the run via a following `review`/`condition`;
 * this panel makes the discrepancy legible.) */
import { useT } from '@/lib/i18n/client';

import {
  asRecord,
  pickArray,
  pickNumber,
  scalar,
} from '../../lib/output-helpers';
import type { RenderPart } from '../../types';
import { KvGrid, type KvRow } from '../kv-grid';
import { OutputFallback } from '../output-fallback';

export function ReconciliationPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const out = asRecord(part.data);
  const matched = pickNumber(out, 'matched', 'reconciled');
  const unmatched = pickNumber(out, 'unmatched', 'discrepancies', 'unresolved');
  const items = pickArray(out, 'unmatchedItems', 'discrepancyItems', 'items');

  const rows: KvRow[] = [];
  if (matched !== undefined)
    rows.push({ label: t('field.matched'), value: String(matched) });
  if (unmatched !== undefined) {
    rows.push({ label: t('field.unmatched'), value: String(unmatched) });
  }

  if (rows.length === 0 && items.length === 0)
    return <OutputFallback part={part} />;

  return (
    <VStack gap={2}>
      <KvGrid rows={rows} />
      {items.slice(0, 20).map((raw, i) => (
        <Text key={i} as="div" variant="muted" truncate>
          {scalar(raw)}
        </Text>
      ))}
    </VStack>
  );
}
