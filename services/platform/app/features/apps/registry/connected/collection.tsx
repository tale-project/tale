'use client';

/**
 * Connected `Collection` block — binds an allowlisted query and renders its rows
 * as a table, with optional per-row actions. Generic: it shows whatever records
 * the bound query returns (columns specified, or inferred from the first row),
 * so any list query can drive it. The reactive binding lives here (Puck only
 * composes the block). Row rendering is delegated to the shared `DataTable`.
 *
 * When `subjectType` is set, each row is expandable to show its workflow run
 * inline (`SubjectRun` → the reused execution view), so a domain list (tasks
 * now; others later) shows execution detail in-context — no separate run page.
 */
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';
import { ListChecks } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import {
  resolveColumnLabels,
  usePackLabelString,
} from '../../runtime/app-runtime';
import { type BoundActionSpec } from './bound-button';
import { DataTable } from './data-table';
import { Section } from './section';
import { SubjectRun } from './subject-run';

export interface CollectionProps {
  title?: string;
  query: { path: string; args?: unknown };
  /** Columns to show; if omitted, inferred from the first row (minus id-like keys). */
  columns?: string[];
  /** Header text per column key — each a `$label:` pack reference or literal. */
  columnLabels?: Record<string, string>;
  actions?: BoundActionSpec[];
  /** When set, rows expand to show their workflow run inline (the execution
   *  "about" this subject). Generic — any domain list opts in. */
  subjectType?: string;
  /** Row field holding the subject id (default `_id`). */
  subjectIdField?: string;
}

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

export function Collection({
  title,
  query,
  columns,
  columnLabels,
  actions,
  subjectType,
  subjectIdField = '_id',
}: CollectionProps) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();
  const { data, isLoading, blocked } = useBoundQuery(query.path, query.args);
  const rows = pickArray(data);

  return (
    <Section title={labelOf(title)} icon={ListChecks}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', { path: query.path })}
        </Text>
      ) : isLoading && rows.length === 0 ? (
        <SkeletonText lines={3} />
      ) : rows.length === 0 ? (
        <Text variant="muted">{t('binding.empty')}</Text>
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          columnLabels={resolveColumnLabels(columnLabels, labelOf)}
          actions={actions}
          expansion={
            subjectType
              ? {
                  idField: subjectIdField,
                  render: (subjectId) => (
                    <SubjectRun
                      subjectType={subjectType}
                      subjectId={subjectId}
                    />
                  ),
                }
              : undefined
          }
        />
      )}
    </Section>
  );
}
