'use client';

/**
 * Connected `Collection` block — binds an allowlisted query and renders its rows
 * as a table, with optional per-row actions. Generic: it shows whatever records
 * the bound query returns (columns specified, or inferred from the first row),
 * so any list query can drive it. The reactive binding lives here (Puck only
 * composes the block); this is the open successor to the old collection-panel +
 * data-source pair.
 */
import { Badge } from '@tale/ui/badge';
import { SkeletonText } from '@tale/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tale/ui/table';
import { Text } from '@tale/ui/text';
import { ListChecks } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { BoundButton, type BoundActionSpec } from './bound-button';
import { Section } from './section';

export interface CollectionProps {
  title?: string;
  query: { path: string; args?: unknown };
  /** Columns to show; if omitted, inferred from the first row (minus id-like keys). */
  columns?: string[];
  actions?: BoundActionSpec[];
}

const HIDDEN = new Set([
  '_id',
  '_creationTime',
  'id',
  'taskId',
  'executionId',
  'organizationId',
  'projectId',
]);

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
  todo: 'slate',
  backlog: 'slate',
};

function pickArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) {
    for (const key of [
      'items',
      'tasks',
      'page',
      'rows',
      'records',
      'results',
    ]) {
      const v = data[key];
      if (Array.isArray(v)) return v.filter(isRecord);
    }
  }
  return [];
}

function cell(col: string, value: unknown) {
  if (col === 'status' && typeof value === 'string') {
    return <Badge variant={STATUS_VARIANT[value] ?? 'slate'}>{value}</Badge>;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value).slice(0, 60);
}

export function Collection({
  title,
  query,
  columns,
  actions,
}: CollectionProps) {
  const { t } = useT('apps');
  const { data, isLoading, blocked } = useBoundQuery(query.path, query.args);
  const rows = pickArray(data);
  const cols =
    columns && columns.length > 0
      ? columns
      : rows[0]
        ? Object.keys(rows[0])
            .filter((k) => !HIDDEN.has(k))
            .slice(0, 6)
        : [];
  const acts = actions ?? [];

  return (
    <Section title={title} icon={ListChecks}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : isLoading && rows.length === 0 ? (
        <SkeletonText lines={3} />
      ) : rows.length === 0 ? (
        <Text variant="muted">{t('binding.empty')}</Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead key={c} className="capitalize">
                  {c}
                </TableHead>
              ))}
              {acts.length > 0 && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 50).map((row, i) => (
              <TableRow key={i}>
                {cols.map((c) => (
                  <TableCell key={c}>{cell(c, row[c])}</TableCell>
                ))}
                {acts.length > 0 && (
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {acts.map((a, ai) => (
                        <BoundButton key={ai} action={a} item={row} />
                      ))}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
