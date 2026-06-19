'use client';

/**
 * Connected `IssueList` block — fetches GitHub issues (one-shot, via the
 * allowlisted `listGitHubIssues` action, paginated) and lets the user turn any
 * issue into a task (the `createTaskFromExternalIssue` action). Issues live in
 * GitHub, so this is a fetch-on-mount/page + refresh block (not a reactive
 * query); creating a task materializes the issue into the reactive `tasks`
 * table, which the rest of the view reads live.
 */
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, VStack } from '@tale/ui/layout';
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
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';

export interface IssueListProps {
  title?: string;
  owner: string;
  repo: string;
  state?: string;
}

const PER_PAGE = 30;

/**
 * The dispatch wraps the connector result as `{ result: { count, data, pagination } }`
 * (tolerate the direct + bare-array shapes too). GitHub's list_issues includes
 * pull requests (they carry a `pull_request` field) — filter those to issues.
 * `hasNext` prefers the connector's pagination flag, else "a full page came back".
 */
function parseResult(result: unknown): {
  issues: Record<string, unknown>[];
  hasNext: boolean;
} {
  const wrapper =
    isRecord(result) && isRecord(result.result) ? result.result : result;
  const rawData =
    isRecord(wrapper) && Array.isArray(wrapper.data)
      ? wrapper.data
      : Array.isArray(result)
        ? result
        : [];
  const issues = rawData.filter(isRecord).filter((r) => !('pull_request' in r));
  const pagination =
    isRecord(wrapper) && isRecord(wrapper.pagination)
      ? wrapper.pagination
      : undefined;
  const hasNext =
    typeof pagination?.hasNextPage === 'boolean'
      ? pagination.hasNextPage
      : rawData.length >= PER_PAGE;
  return { issues, hasNext };
}

function str(rec: Record<string, unknown>, key: string): string {
  const v = rec[key];
  return typeof v === 'string' ? v : '';
}

export function IssueList({
  title,
  owner,
  repo,
  state = 'open',
}: IssueListProps) {
  const { t } = useT('apps');
  const list = useBoundAction(
    'integrations/public_actions:listGitHubIssues',
    'action',
  );
  const create = useBoundAction(
    'tasks/public_actions:createTaskFromExternalIssue',
    'action',
  );
  // dispatch identity is unstable; read the latest via a ref so the fetch effect
  // depends only on the GitHub params + page, not the hook object.
  const listRef = useRef(list);
  listRef.current = list;

  const [issues, setIssues] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(new Set<number>());

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listRef.current.dispatch({
        organizationId: '$orgId',
        owner,
        repo,
        state,
        page,
        perPage: PER_PAGE,
      });
      const parsed = parseResult(result);
      setIssues(parsed.issues);
      setHasNext(parsed.hasNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [owner, repo, state, page]);

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  const onCreate = async (issue: Record<string, unknown>) => {
    const number = typeof issue.number === 'number' ? issue.number : undefined;
    await create.dispatch({
      organizationId: '$orgId',
      externalSystem: 'github',
      externalId: `${owner}/${repo}#${number ?? ''}`,
      title: str(issue, 'title'),
      externalUrl: str(issue, 'html_url'),
      description: str(issue, 'body'),
    });
    if (number !== undefined) {
      setCreated((prev) => new Set(prev).add(number));
    }
  };

  return (
    <VStack gap={3}>
      <HStack gap={3} className="items-center justify-between">
        {title && (
          <Text as="span" className="text-lg font-semibold">
            {title}
          </Text>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void fetchIssues()}
        >
          {t('issues.refresh')}
        </Button>
      </HStack>

      {loading && issues.length === 0 ? (
        <SkeletonText lines={3} />
      ) : error ? (
        <Text variant="error">{t('issues.error', { error })}</Text>
      ) : issues.length === 0 ? (
        <Text variant="muted">{t('issues.none')}</Text>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>{t('issues.colTitle')}</TableHead>
                <TableHead>{t('issues.colState')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue, i) => {
                const number =
                  typeof issue.number === 'number' ? issue.number : undefined;
                const done = number !== undefined && created.has(number);
                return (
                  <TableRow key={i}>
                    <TableCell>{number ?? '—'}</TableCell>
                    <TableCell>{str(issue, 'title')}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          str(issue, 'state') === 'open' ? 'green' : 'slate'
                        }
                      >
                        {str(issue, 'state')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={done ? 'ghost' : 'secondary'}
                        disabled={done || create.isPending}
                        onClick={() => void onCreate(issue)}
                      >
                        {done ? t('issues.created') : t('issues.createTask')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <HStack gap={3} className="items-center justify-end">
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('issues.prev')}
            </Button>
            <Text variant="muted" className="text-sm">
              {t('issues.page', { page })}
            </Text>
            <Button
              size="sm"
              variant="ghost"
              disabled={loading || !hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('issues.next')}
            </Button>
          </HStack>
        </>
      )}
    </VStack>
  );
}
