'use client';

/**
 * Connected `RunList` block — the entry to watch real-time execution. Binds the
 * allowlisted `listExecutions` query (reactive) and renders recent runs; each row
 * links to the canonical OPERATOR view for that execution (stage timeline +
 * per-step live panels), reusing it rather than rebuilding a live view here.
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
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
import { useNavigate } from '@tanstack/react-router';
import { Activity } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundQuery } from '../../hooks/use-bound-query';
import { useAppRuntime, usePackLabelString } from '../../runtime/app-runtime';
import { STATUS_VARIANT } from './data-table';
import { Section } from './section';

export interface RunListProps {
  title?: string;
  workflowSlug: string;
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

function pickPage(data: unknown): Record<string, unknown>[] {
  if (isRecord(data) && Array.isArray(data.page))
    return data.page.filter(isRecord);
  return [];
}

function fmt(ts: unknown): string {
  return typeof ts === 'number' && ts > 0
    ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
    : '—';
}

export function RunList({ title, workflowSlug }: RunListProps) {
  const { t } = useT('apps');
  const labelOf = usePackLabelString();
  const { organizationId, projectId, appSlug } = useAppRuntime();
  const navigate = useNavigate();
  const args = useMemo(
    () => ({
      paginationOpts: { numItems: 25, cursor: null },
      wfDefinitionId: workflowSlug,
    }),
    [workflowSlug],
  );
  const { data, isLoading, blocked } = useBoundQuery(
    'workflow_executions/queries:listExecutions',
    args,
  );
  const runs = pickPage(data);

  return (
    <Section title={labelOf(title)} icon={Activity}>
      {blocked ? (
        <Text variant="error">
          {t('binding.blocked', {
            path: 'workflow_executions/queries:listExecutions',
          })}
        </Text>
      ) : isLoading && runs.length === 0 ? (
        <SkeletonText lines={3} />
      ) : runs.length === 0 ? (
        <Text variant="muted">{t('runs.none')}</Text>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('runs.colRun')}</TableHead>
              <TableHead>{t('runs.colStatus')}</TableHead>
              <TableHead>{t('runs.colStarted')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.slice(0, 25).map((run, i) => {
              const id = str(run, '_id');
              const status = str(run, 'status');
              return (
                <TableRow key={i}>
                  <TableCell>{id ? `${id.slice(0, 8)}…` : '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[status] ?? 'slate'}>
                      {status || 'unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell>{fmt(run.startedAt)}</TableCell>
                  <TableCell>
                    <Button
                      variant="secondary"
                      disabled={!id}
                      onClick={() =>
                        // A project-scoped app watches runs under its project
                        // route (keeping the project shell + tab); org apps use
                        // the org-level run route. Pass the workflow slug so the
                        // run view can load the reused global DAG with live
                        // per-node status.
                        void (projectId
                          ? navigate({
                              to: '/dashboard/$id/projects/$projectId/apps/$appSlug/runs/$executionId',
                              params: {
                                id: organizationId,
                                projectId,
                                appSlug,
                                executionId: id,
                              },
                              search: { wf: workflowSlug },
                            })
                          : navigate({
                              to: '/dashboard/$id/apps/$appSlug/runs/$executionId',
                              params: {
                                id: organizationId,
                                appSlug,
                                executionId: id,
                              },
                              search: { wf: workflowSlug },
                            }))
                      }
                    >
                      {t('runs.watchLive')}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Section>
  );
}
