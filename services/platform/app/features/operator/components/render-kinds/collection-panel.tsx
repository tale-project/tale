'use client';

/** `collection` — N homogeneous items. `params.layout` (table | list | cards)
 * picks the presentation; folds table/grid/list/schema-profile into one kind.
 * A `status` column renders as a colored badge; internal id columns are hidden
 * from display (kept in the data for future row links). */
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
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
import type { RenderPart } from '../../types';
import { OutputFallback } from '../output-fallback';

function resolveLayout(value: string | undefined): CollectionLayout {
  if (value === 'table' || value === 'list' || value === 'cards') return value;
  return 'list';
}

const HIDDEN_COLS = new Set(['executionId', 'id', 'taskId']);

function columnsOf(items: unknown[]): string[] {
  const first = asRecord(items[0]);
  return first
    ? Object.keys(first)
        .filter((k) => !HIDDEN_COLS.has(k))
        .slice(0, 6)
    : [];
}

const STATUS_VARIANT: Record<
  string,
  'green' | 'destructive' | 'blue' | 'yellow' | 'slate'
> = {
  completed: 'green',
  done: 'green',
  failed: 'destructive',
  running: 'blue',
  in_progress: 'blue',
  paused: 'yellow',
  waiting: 'yellow',
  in_review: 'yellow',
  cancelled: 'slate',
  canceled: 'slate',
  pending: 'slate',
  unknown: 'slate',
};

function CellValue({ col, value }: { col: string; value: unknown }) {
  if (col === 'status' && typeof value === 'string') {
    return <Badge variant={STATUS_VARIANT[value] ?? 'slate'}>{value}</Badge>;
  }
  return <Text as="span">{scalar(value)}</Text>;
}

export function CollectionPanel({ part }: { part: RenderPart }) {
  const { t } = useT('operator');
  const out = asRecord(part.data);
  const items = pickArray(out, 'items', 'rows', 'records', 'results');
  const layout = resolveLayout(part.params?.layout);

  if (items.length === 0) return <OutputFallback part={part} />;
  const shown = items.slice(0, 50);

  if (layout === 'table') {
    const cols = columnsOf(shown);
    if (cols.length > 0) {
      return (
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className="capitalize">
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((raw, i) => {
              const row = asRecord(raw);
              return (
                <TableRow key={i}>
                  {cols.map((c) => (
                    <TableCell key={c}>
                      <CellValue col={c} value={row?.[c]} />
                    </TableCell>
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
