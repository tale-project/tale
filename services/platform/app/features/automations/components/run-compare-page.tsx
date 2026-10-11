'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Card } from '@tale/ui/card';
import { ContentArea } from '@tale/ui/content-area';
import { DataDiff } from '@tale/ui/data-diff';
import { mergeFlowGraphs } from '@tale/ui/flow/diff';
import type { FlowRow } from '@tale/ui/flow/types';
import { IconButton } from '@tale/ui/icon-button';
import { SectionHeader } from '@tale/ui/section-header';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, GitCompare, Hand } from 'lucide-react';
import { useMemo } from 'react';

import type { RunDiff } from '@/app/lib/backend/contract/automations';
import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';

import { mergeNodeTypes } from '../hooks/backend';
import {
  useAutomation,
  useAutomationAtVersion,
  useAutomationRun,
  useNodeTypeCatalog,
  useRunCompare,
} from '../hooks/queries';
import { useCanvasFlow } from '../hooks/use-canvas-flow';
import { compareVersionLink } from '../lib/detail-paths';
import { readDocument } from '../lib/document';
import { automationErrorCode } from '../lib/errors';
import { nodeCatalogView, nodeTitle } from '../lib/node-face';
import { compareSummary } from '../lib/run-compare';
import { readRunStatus, runOnCanvas, shortRunId } from '../lib/run-view';
import { AutomationCanvas } from './automation-canvas';
import { AutomationVersionPill } from './automation-version-pill';
import { RunBadge } from './run-status-badge';

type NodeDiff = RunDiff['nodes'][number];
type Side = NonNullable<NodeDiff['a']>;

/** Refusals that mean there is nothing to compare: a run is gone, or the
 *  two belong to different automations. */
const MISSING: ReadonlySet<string> = new Set([
  'RUN_NOT_FOUND',
  'RUN_COMPARE_MISMATCH',
]);

/** Nobody checks a stored version again here: the graph is its shape. */
const NO_CHECK = { status: 'off', analysis: null, types: null } as const;

/** A document with no steps: what a version stands for while it loads. */
const NO_DOCUMENT: Automation = { name: '', nodes: [] };

/** Where the comparison's automation lives: its versions link from here. */
interface ComparePlace {
  organizationId: string;
  automationSlug?: string | undefined;
  projectId?: string | undefined;
  /** The live version, so a run of it says so. */
  deployedVersion?: number | undefined;
}

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
  place,
}: {
  letter: 'A' | 'B';
  run: RunDiff['a'];
  runsPath: string;
  place: ComparePlace;
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
        {place.automationSlug === undefined ? (
          <Text as="span" className="text-sm">
            {tAutomations('versions.versionLabel', { version: run.version })}
          </Text>
        ) : (
          <AutomationVersionPill
            organizationId={place.organizationId}
            automationSlug={place.automationSlug}
            projectId={place.projectId}
            version={run.version}
            deployedVersion={place.deployedVersion}
          />
        )}
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
  /** The automation the runs belong to: with it, the page draws both runs
   * on its chart. */
  automationSlug?: string;
  /** The automation's runs, where each run's page hangs. */
  runsPath: string;
  /** The project the page is opened in: versions open inside it. */
  projectId?: string;
  a?: string;
  b?: string;
  onSwap: () => void;
}

type RunRead = NonNullable<ReturnType<typeof useAutomationRun>['data']>;

/**
 * Both runs on one chart: each step's strip says how A and how B left it,
 * and a step where they part is marked. Runs of one version share its
 * chart; runs of two versions are drawn on both versions' steps together,
 * and a step one run's version lacks is drawn dashed for that run.
 */
function RunCompareCanvas({
  organizationId,
  automationSlug,
  diff,
  runA,
  runB,
}: {
  organizationId: string;
  automationSlug: string;
  diff: RunDiff;
  runA: RunRead;
  runB: RunRead;
}) {
  const { t } = useT('automationRuns');
  const { t: tAutomations } = useT('automations');
  const versionQuery = useAutomation(
    organizationId,
    automationSlug,
    diff.b.version,
  );
  // A's version: the same read as B's when both ran one version.
  const versionAQuery = useAutomation(
    organizationId,
    automationSlug,
    diff.a.version,
  );
  const catalogQuery = useNodeTypeCatalog(organizationId);
  const automation = useMemo(
    () => readDocument(versionQuery.data?.document),
    [versionQuery.data?.document],
  );
  const automationA = useMemo(
    () => readDocument(versionAQuery.data?.document),
    [versionAQuery.data?.document],
  );
  const catalog = useMemo(
    () =>
      nodeCatalogView(
        mergeNodeTypes(catalogQuery.data?.nodeTypes),
        catalogQuery.data?.connectors ?? [],
      ),
    [catalogQuery.data?.nodeTypes, catalogQuery.data?.connectors],
  );
  const manualOnly = useMemo<readonly FlowRow[]>(
    () => [
      {
        id: 'trigger:manual',
        icon: Hand,
        label: tAutomations('canvas.start.manual'),
      },
    ],
    [tAutomations],
  );
  // Two versions: each one's chart, then their union. One version needs
  // neither — the canvas draws it from its document.
  const twoVersions =
    !diff.version.same && automationA !== null && automation !== null;
  const flowA = useCanvasFlow({
    automation: twoVersions ? automationA : NO_DOCUMENT,
    catalog,
    triggers: manualOnly,
    check: NO_CHECK,
  });
  const flowB = useCanvasFlow({
    automation: twoVersions ? automation : NO_DOCUMENT,
    catalog,
    triggers: manualOnly,
    check: NO_CHECK,
  });
  const union = useMemo(
    () =>
      twoVersions
        ? mergeFlowGraphs(flowA.graph, flowB.graph, () => undefined).graph
        : undefined,
    [twoVersions, flowA.graph, flowB.graph],
  );
  const compare = useMemo(() => {
    if (automation === null) return undefined;
    if (union === undefined) {
      const ids = automation.nodes.map((node) => node.id);
      return {
        a: runOnCanvas(runA, ids),
        b: runOnCanvas(runB, ids),
        absentInA: diff.version.added,
      };
    }
    // Every run on its own version's steps; a step of the union one
    // version lacks is absent for the run of that version.
    const inA = new Set(flowA.graph.nodes.map((node) => node.id));
    const inB = new Set(flowB.graph.nodes.map((node) => node.id));
    return {
      a: runOnCanvas(
        runA,
        (automationA ?? NO_DOCUMENT).nodes.map((node) => node.id),
      ),
      b: runOnCanvas(
        runB,
        automation.nodes.map((node) => node.id),
      ),
      absentInA: union.nodes
        .filter((node) => !inA.has(node.id))
        .map((node) => node.id),
      absentInB: union.nodes
        .filter((node) => !inB.has(node.id))
        .map((node) => node.id),
    };
  }, [
    automation,
    automationA,
    union,
    flowA.graph,
    flowB.graph,
    runA,
    runB,
    diff.version.added,
  ]);
  if (automation === null || compare === undefined) return null;
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader as="h3" size="sm" title={t('compare.canvas')} />
      <div className="h-[28rem]">
        <AutomationCanvas
          automation={automation}
          {...(union !== undefined && { graph: union })}
          layoutKey={`compare:${diff.a.id}:${diff.b.id}`}
          catalog={catalog}
          // Nothing opens from here: the steps table below says the rest.
          selectedId={null}
          onSelect={() => undefined}
          compare={compare}
        />
      </div>
    </section>
  );
}

/**
 * Two runs of one automation side by side: what differs between them in
 * words, each run's outcome, and every step as each run left it — so a
 * reader sees where a run that failed parted from one that worked.
 */
export function RunComparePage({
  organizationId,
  automationSlug,
  runsPath,
  projectId,
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
  // B's version, which the chart reads too: it names the live version, so
  // a run of it says so.
  const versionB = useAutomationAtVersion(
    organizationId,
    automationSlug ?? '',
    automationSlug === undefined || diff === undefined || diff === null
      ? undefined
      : diff.b.version,
  );
  const place: ComparePlace = {
    organizationId,
    automationSlug,
    projectId,
    deployedVersion: versionB.data?.deployedVersion,
  };
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
              <RunCard
                letter="A"
                run={diff.a}
                runsPath={runsPath}
                place={place}
              />
              <IconButton
                icon={ArrowLeftRight}
                variant="ghost"
                size="sm"
                aria-label={t('compare.swap')}
                className="self-center"
                onClick={onSwap}
              />
              <RunCard
                letter="B"
                run={diff.b}
                runsPath={runsPath}
                place={place}
              />
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
              {/* Two versions ran: what one changed against the other is
                the comparison of the versions themselves. */}
              {!diff.version.same && automationSlug !== undefined && (
                <Link
                  {...compareVersionLink({
                    organizationId,
                    automationSlug,
                    projectId,
                    version: diff.b.version,
                    from: diff.a.version,
                  })}
                  className="text-foreground inline-flex min-h-6 items-center gap-1.5 self-start text-sm font-medium underline underline-offset-2"
                >
                  <GitCompare className="size-4 shrink-0" aria-hidden="true" />
                  {t('compare.differs.seeVersions', {
                    a: String(diff.a.version),
                    b: String(diff.b.version),
                  })}
                </Link>
              )}
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
            {automationSlug !== undefined &&
              runA.data !== undefined &&
              runA.data !== null &&
              runB.data !== undefined &&
              runB.data !== null && (
                <RunCompareCanvas
                  organizationId={organizationId}
                  automationSlug={automationSlug}
                  diff={diff}
                  runA={runA.data}
                  runB={runB.data}
                />
              )}
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
