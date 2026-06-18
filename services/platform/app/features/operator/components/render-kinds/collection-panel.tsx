'use client';

import { Card } from '@tale/ui/card';
/** `collection` — N homogeneous items. `params.layout` (table | list | cards)
 * picks the presentation; folds table/grid/list/schema-profile into one kind. */
import { Grid, VStack } from '@tale/ui/layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';

import { useT } from '@/lib/i18n/client';
import type { CollectionLayout } from '@/lib/shared/platform/render_kinds';

import { asRecord, pickArray, scalar } from '../../lib/output-helpers';
import type { StepProjection } from '../../types';
import { OutputFallback } from '../output-fallback';

function resolveLayout(value: string | undefined): CollectionLayout {
  if (value === 'table' || value === 'list' || value === 'cards') return value;
  return 'list';
}

function columnsOf(items: unknown[]): string[] {
  const first = asRecord(items[0]);
  return first ? Object.keys(first).slice(0, 6) : [];
}

export function CollectionPanel({ step }: { step: StepProjection }) {
  const { t } = useT('operator');
  const out = asRecord(step.output);
  const items = pickArray(out, 'items', 'rows', 'records', 'results');
  const layout = resolveLayout(step.params?.layout);

  if (items.length === 0) return <OutputFallback step={step} />;
  const shown = items.slice(0, 50);

  if (layout === 'table') {
    const cols = columnsOf(shown);
    if (cols.length > 0) {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c}>{c}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((raw, i) => {
              const row = asRecord(raw);
              return (
                <TableRow key={i}>
                  {cols.map((c) => (
                    <TableCell key={c}>{scalar(row?.[c])}</TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      );
    }
  }

  if (layout === 'cards') {
    return (
      <Grid className="grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((raw, i) => (
          <Card key={i}>
            <Text as="div" truncate>
              {scalar(raw)}
            </Text>
          </Card>
        ))}
      </Grid>
    );
  }

  return (
    <VStack gap={1}>
      <Text as="span" variant="muted">
        {t('field.count')}: {items.length}
      </Text>
      {shown.map((raw, i) => (
        <Text key={i} as="div" truncate>
          {scalar(raw)}
        </Text>
      ))}
    </VStack>
  );
}
