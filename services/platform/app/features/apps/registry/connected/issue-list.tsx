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
import { HStack } from '@tale/ui/layout';
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
import { CircleDot } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { interpolateTemplate } from '@/lib/shared/utils/interpolate';
import { isRecord } from '@/lib/utils/type-utils';

import { useBoundAction } from '../../hooks/use-bound-action';
import { usePackLabel } from '../../runtime/app-runtime';
import { Section } from './section';

export interface IssueListProps {
  title?: string;
  owner: string;
  repo: string;
  state?: string;
  /** Pack `labelKey` of the task-description template, with `{title}`/`{number}`/
   * `{url}` placeholders. Resolved against the app's active-locale catalog so the
   * created task reads as a natural-language instruction in the user's locale. */
  taskTemplateKey?: string;
}

const PER_PAGE = 30;

// Generic fallback when the app ships no template (the block is app-agnostic).
const DEFAULT_TASK_TEMPLATE =
  'Resolve this GitHub issue: {title} (#{number}). Details: {url}';

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
  taskTemplateKey,
}: IssueListProps) {
  const { t } = useT('apps');
  const packLabel = usePackLabel();
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
    // Tasks are handled by an LLM, so the description is a natural-language
    // instruction generated from a localized template (the user's locale, via
    // the pack catalog) — not the raw issue body. The structured external* refs
    // are kept as metadata (trigger filter, dedup key, repo-clone source).
    const template = packLabel(taskTemplateKey, DEFAULT_TASK_TEMPLATE);
    const description = interpolateTemplate(template, {
      title: str(issue, 'title'),
      number: number ?? '',
      url: str(issue, 'html_url'),
    });
    await create.dispatch({
      organizationId: '$orgId',
      externalSystem: 'github',
      externalId: `${owner}/${repo}#${number ?? ''}`,
      title: str(issue, 'title'),
      externalUrl: str(issue, 'html_url'),
      description,
    });
    if (number !== undefined) {
      setCreated((prev) => new Set(prev).add(number));
    }
  };

  const refresh = (
    <Button
      size="sm"
      variant="ghost"
      disabled={loading}
      onClick={() => void fetchIssues()}
    >
      {t('issues.refresh')}
    </Button>
  );

  return (
    <Section title={title} icon={CircleDot} action={refresh}>
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
    </Section>
  );
}
