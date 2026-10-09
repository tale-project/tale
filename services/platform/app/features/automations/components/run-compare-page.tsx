'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { ContentArea } from '@tale/ui/content-area';
import { DataDiff } from '@tale/ui/data-diff';
import { IconButton } from '@tale/ui/icon-button';
import { SectionHeader } from '@tale/ui/section-header';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight } from 'lucide-react';

import type { RunDiff } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { useAutomationRun, useRunCompare } from '../hooks/queries';
import { automationErrorCode } from '../lib/errors';
import { nodeTitle } from '../lib/node-face';
import { compareSummary } from '../lib/run-compare';
import { readRunStatus, shortRunId } from '../lib/run-view';
import { RunBadge } from './run-status-badge';

type NodeDiff = RunDiff['nodes'][number];
type Side = NonNullable<NodeDiff['a']>;

/** Refusals that mean there is nothing to compare: a run is gone, or the
 *  two belong to different automations. */
const MISSING: ReadonlySet<string> = new Set([
  'RUN_NOT_FOUND',
  'RUN_COMPARE_MISMATCH',
]);

/** Steps the table lists: the version's own, not Start and End. */
const RESERVED: ReadonlySet<string> = new Set(['__start', '__end']);

/** A side's status in the table's words key. */
function statusKey(side: Side | undefined): string {
  if (side === undefined) return 'none';
  if (side.reused === true) return 'reused';
  return side.status;
}

/** Whether a step's data differs: either value does; the same when both
 *  are known to match; unknown otherwise. */
function dataVerdict(node: NodeDiff): 'same' | 'differs' | 'none' {
  if (node.input.equal === false || node.output.equal === false) {
    return 'differs';
  }
  if (node.input.equal === true && node.output.equal === true) return 'same';
  return 'none';
}

/** One run of the two: its letter, how it ended, its version and mode,
 *  when it started, and the way to its page. */
function RunCard({
  letter,
  run,
  runsPath,
}: {
  letter: 'A' | 'B';
  run: RunDiff['a'];
  runsPath: string;
}) {
  const { t } = useT('automationRuns');
  const { t: tAutomations } = useT('automations');
  const { formatDate } = useFormatDate();
  const href: string = `${runsPath}/${run.id}`;
  return (
    <Card padding="md" className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-semibold">
          {letter}
        </Badge>
        <RunBadge status={readRunStatus(run.status)} />
        <Badge variant={run.mode === 'live' ? 'orange' : 'slate'}>
          {tAutomations(`runs.mode.${run.mode === 'live' ? 'live' : 'mock'}`)}
        </Badge>
        <Text as="span" className="text-sm">
          {tAutomations('versions.versionLabel', { version: run.version })}
        </Text>
      </div>
      <Text as="span" variant="muted" className="text-xs">
        {formatDate(new Date(run.startedAt), 'long')}
      </Text>
      <Link
        to={href}
        className="text-foreground inline-flex min-h-6 items-center self-start text-xs font-medium underline underline-offset-2"
      >
        {t('compare.run', { id: shortRunId(run.id) })}
      </Link>
    </Card>
  );
}

export interface RunComparePageProps {
  organizationId: string;
  /** The automation's runs, where each run's page hangs. */
  runsPath: string;
  a?: string;
  b?: string;
  onSwap: () => void;
}

/**
 * Two runs of one automation side by side: what differs between them in
 * words, each run's outcome, and every step as each run left it — so a
 * reader sees where a run that failed parted from one that worked.
 */
export function RunComparePage({
  organizationId,
  runsPath,
  a,
  b,
  onSwap,
}: RunComparePageProps) {
  const { t } = useT('automationRuns');
  const sameRun = a !== undefined && a === b;
  const compare = useRunCompare(
    organizationId,
    sameRun ? undefined : a,
    sameRun ? undefined : b,
  );
  const diff = compare.data;
  // The two runs' input and output, for the diffs a reader can open.
  const runA = useAutomationRun(organizationId, sameRun ? undefined : a);
  const runB = useAutomationRun(organizationId, sameRun ? undefined : b);

  let body;
  if (a === undefined || b === undefined || sameRun) {
    body = <Alert variant="info" description={t('compare.same')} />;
  } else if (
    compare.isError &&
    !MISSING.has(automationErrorCode(compare.error) ?? '')
  ) {
    body = (
      <Alert variant="destructive" description={t('compare.loadFailed')} />
    );
  } else if (diff === null || compare.isError) {
    body = <Alert variant="info" description={t('compare.notFound')} />;
  } else {
    const rows = (diff?.nodes ?? []).filter(
      (node) => !RESERVED.has(node.nodeId),
    );
    const summary =
      diff === undefined
        ? []
        : compareSummary(diff, { t, stepLabel: nodeTitle });
    body = (
      <Skeletonize loading={diff === undefined} label={t('compare.title')}>
        {diff !== undefined && (
          <div className="@container flex flex-col gap-4">
            <div className="flex flex-col items-stretch gap-2 @3xl:flex-row @3xl:items-center">
              <RunCard letter="A" run={diff.a} runsPath={runsPath} />
              <IconButton
                icon={ArrowLeftRight}
                variant="ghost"
                size="sm"
                aria-label={t('compare.swap')}
                className="self-center"
                onClick={onSwap}
              />
              <RunCard letter="B" run={diff.b} runsPath={runsPath} />
            </div>
            <section className="flex flex-col gap-2">
              <SectionHeader
                as="h3"
                size="sm"
                title={t('compare.differs.title')}
              />
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {summary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
            {(['output', 'input'] as const).map((side) => {
              const before = runA.data?.[side];
              const after = runB.data?.[side];
              if (diff[side].equal !== false) return null;
              if (before === undefined || after === undefined) return null;
              const title = t(`compare.diff.${side}`);
              return (
                <section key={side} className="flex flex-col gap-2">
                  <SectionHeader as="h3" size="sm" title={title} />
                  <DataDiff
                    before={before}
                    after={after}
                    layout="split"
                    labels={{ before: 'A', after: 'B' }}
                    aria-label={title}
                  />
                </section>
              );
            })}
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('compare.table.label')}</caption>
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('compare.table.step')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    A
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    B
                  </th>
                  <th scope="col" className="py-1.5 font-medium">
                    {t('compare.table.data')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((node) => {
                  const data = dataVerdict(node);
                  return (
                    <tr
                      key={node.path}
                      data-differs={node.differs !== undefined || undefined}
                      className="data-[differs]:bg-muted/50 border-t"
                    >
                      <th
                        scope="row"
                        className="py-1.5 pr-3 font-medium"
                        style={{
                          paddingLeft:
                            node.path === node.nodeId ? undefined : '1rem',
                        }}
                      >
                        {nodeTitle(node.nodeId)}
                      </th>
                      <td className="py-1.5 pr-3">
                        {t(`compare.status.${statusKey(node.a)}`)}
                      </td>
                      <td className="py-1.5 pr-3">
                        {t(`compare.status.${statusKey(node.b)}`)}
                      </td>
                      <td className="text-muted-foreground py-1.5">
                        {t(`compare.table.${data}`)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {diff === undefined && (
          <div className="flex flex-col gap-3" aria-hidden="true">
            <SkeletonBox fullWidth className="h-24">
              <span />
            </SkeletonBox>
          </div>
        )}
      </Skeletonize>
    );
  }

  return (
    <ContentArea gap={4}>
      <SectionHeader as="h2" size="lg" title={t('compare.title')} />
      {body}
    </ContentArea>
  );
}
