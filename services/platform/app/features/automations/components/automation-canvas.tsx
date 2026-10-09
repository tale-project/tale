'use client';

import { Alert } from '@tale/ui/alert';
import { EmptyState } from '@tale/ui/empty-state';
import { flowCompareFromOverlays } from '@tale/ui/flow/compare';
import type { FlowLegendEntry } from '@tale/ui/flow/flow-legend';
import type { FlowHighlight } from '@tale/ui/flow/paths';
import {
  buildPlaybackTimeline,
  usePlaybackClock,
} from '@tale/ui/flow/playback';
import { FlowPlaybackBar, formatFlowClock } from '@tale/ui/flow/playback-bar';
import {
  FlowRunTimeline,
  type FlowTimelineRow,
} from '@tale/ui/flow/run-timeline';
import type { FlowLayout, FlowRow } from '@tale/ui/flow/types';
import {
  WorkflowCanvas,
  type FlowView,
  type WorkflowCanvasProps,
} from '@tale/ui/flow/workflow-canvas';
import { formatDuration } from '@tale/ui/format-duration';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import type { IssueCounts } from '@tale/ui/issue-summary';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { useMediaQuery } from '@tale/ui/use-media-query';
import { AlertTriangle, Hand, Workflow } from 'lucide-react';
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { RunRecordView } from '@/app/lib/backend/contract/automations';
import type { Automation } from '@/lib/engine/core/types';
import { useT } from '@/lib/i18n/client';
import type {
  AnalysisView,
  TypesView,
} from '@/lib/shared/schemas/automation-issues';

import { useCanvasFlow } from '../hooks/use-canvas-flow';
import type { NodeCatalogView, ReturnsSource } from '../lib/node-face';
import { runOverlay } from '../lib/run-overlay';
import { realRunOf, type TimelineWords } from '../lib/run-timeline';
import type { NodeRunStatus, RunProjection, RunStatus } from '../lib/run-view';
import { AUTOMATION_WORKBENCH_COMPACT_QUERY } from '../lib/workbench';
import {
  AutomationPathsButton,
  AutomationPathsPanel,
  AutomationPathsPill,
  AutomationPathsSheet,
} from './automation-paths';

/** A run laid over the canvas. */
export interface CanvasRun {
  statusByNode: ReadonlyMap<string, NodeRunStatus>;
  projection: RunProjection;
  status: RunStatus;
  /** Who or what started it, for Start's strip. */
  startedBy?: string;
  /** The run step by step: with it, the canvas plays the run back. */
  record?: RunRecordView;
  /** What the playback says about a step or a wait. */
  words?: TimelineWords;
  /** The run is still going: the playback follows its end. */
  live?: boolean;
}

/** Two runs on one chart: how each left every step, side by side. */
export interface CanvasCompare {
  a: CanvasRun;
  b: CanvasRun;
  /** Steps of the document drawn (B's version) that A's version lacks. */
  absentInA?: readonly string[];
}

export interface AutomationCanvasProps {
  /** The document on screen. */
  automation: Automation;
  /** What the canvas is a picture of: the automation and the version on
   *  screen. The same key with a changed document glides to its new
   *  layout; a new key is another picture. */
  layoutKey: string;
  catalog: NodeCatalogView;
  modelLabel?: (id: string) => string | undefined;
  /** Start's trigger rows; by hand, the API or MCP when left out. */
  triggers?: readonly FlowRow[];
  /** What the draft check answered, when the reader may have one. */
  check?: {
    status: ReturnsSource['status'];
    analysis: AnalysisView | null;
    types: TypesView | null;
  };
  /** Why a trigger's runs are refused, said on Start. */
  startNotice?: string | null;
  /** Problems per box: a node, its condition, Start or End. */
  issueCounts?: ReadonlyMap<string, IssueCounts>;
  /** The open box: a node, a condition, Start or End. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Id of the inspector region a box opens; without one, a box opens
   * nothing (a comparison's chart). */
  inspectorId?: string;
  run?: CanvasRun;
  /** Two runs of this document side by side; wins over `run`. */
  compare?: CanvasCompare;
  /** Bring this box into view. */
  revealId?: string | null;
  /** Nodes another window or a coding agent changed, ringed once. */
  changed?: { ids: ReadonlySet<string>; key: string | number };
  /**
   * Draw the canvas as a bordered frame (a run's page). The Editor tab's
   * edge-to-edge workbench turns it off.
   * @default true
   */
  framed?: boolean;
  view?: FlowView;
  onViewChange?: (view: FlowView) => void;
  /** The top-left corner (the view switch). */
  topStart?: ReactNode;
  /** Verbs after Paths in the top-right corner. */
  topEnd?: ReactNode;
  /** The bottom-centre toolbar. */
  toolbar?: ReactNode;
  /** The main action of an automation with no nodes yet. */
  emptyAction?: ReactNode;
  /** Each layout once it is on the page (tests measure it). */
  onLayout?: (layout: FlowLayout) => void;
}

const NO_CHECK: NonNullable<AutomationCanvasProps['check']> = {
  status: 'off',
  analysis: null,
  types: null,
};

/**
 * The automation canvas: the document, drawn by `@tale/ui`'s
 * `WorkflowCanvas` and laid out by it — nobody places a node, and a
 * document's stored positions are never read.
 *
 * Start says what starts a run and what it receives; End what a successful
 * run returns and how a run ends; each condition sits above its node in
 * words, with Yes and No when an `elseOf` partner hangs from it. The Paths
 * list shows every way a run can go and lights one up on the chart. A run
 * lays its outcome over every box.
 */
export function AutomationCanvas({
  automation,
  layoutKey,
  catalog,
  modelLabel,
  triggers,
  check = NO_CHECK,
  startNotice,
  issueCounts,
  selectedId,
  onSelect,
  inspectorId,
  run,
  compare,
  revealId,
  changed,
  framed = true,
  view,
  onViewChange,
  topStart,
  topEnd,
  toolbar,
  emptyAction,
  onLayout,
}: AutomationCanvasProps) {
  const { t } = useT('automations');
  const compact = useMediaQuery(AUTOMATION_WORKBENCH_COMPACT_QUERY);
  const panelId = useId();
  const manualOnly = useMemo<readonly FlowRow[]>(
    () => [
      { id: 'trigger:manual', icon: Hand, label: t('canvas.start.manual') },
    ],
    [t],
  );
  const [pathsOpen, setPathsOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  const flow = useCanvasFlow({
    automation,
    catalog,
    ...(modelLabel !== undefined && { modelLabel }),
    triggers: triggers ?? manualOnly,
    check,
    ...(startNotice !== undefined && { startNotice }),
    pinnedPath: pinnedId,
  });
  const { graph, paths, hasCycle } = flow;

  // A path that is no longer there (the document changed, another
  // picture) is no longer shown.
  const pinnedInfo = pinnedId === null ? undefined : paths?.rows.get(pinnedId);
  useEffect(() => {
    if (pinnedId !== null && pinnedInfo === undefined) setPinnedId(null);
  }, [pinnedId, pinnedInfo]);
  useEffect(() => {
    setPinnedId(null);
    setPreviewId(null);
  }, [layoutKey]);

  const shownRow = pinnedId ?? previewId;
  const highlight = useMemo<FlowHighlight | null>(
    () =>
      shownRow === null || paths === null
        ? null
        : paths.highlightFor(shownRow, shownRow === pinnedId),
    [shownRow, pinnedId, paths],
  );

  const overlay = useMemo(
    () =>
      run === undefined || compare !== undefined
        ? undefined
        : runOverlay({
            graph,
            statusByNode: run.statusByNode,
            projection: run.projection,
            status: run.status,
            t,
            ...(run.startedBy !== undefined && { startedBy: run.startedBy }),
          }),
    [run, compare, graph, t],
  );
  // Two runs: each as one run's overlay, then how each left every step.
  const compared = useMemo(() => {
    if (compare === undefined) return undefined;
    const overlayOf = (side: CanvasRun) =>
      runOverlay({
        graph,
        statusByNode: side.statusByNode,
        projection: side.projection,
        status: side.status,
        t,
      });
    return flowCompareFromOverlays(
      graph,
      overlayOf(compare.a),
      overlayOf(compare.b),
      {
        labels: { a: 'A', b: 'B' },
        absent: { a: [...(compare.absentInA ?? [])] },
      },
    );
  }, [compare, graph, t]);

  const legend = useMemo<FlowLegendEntry[]>(
    () => [
      { id: 'data', swatch: { edge: 'data' }, label: t('canvas.legend.data') },
      {
        id: 'control',
        swatch: { edge: 'order' },
        label: t('canvas.legend.control'),
      },
      { id: 'gate', swatch: { node: 'gate' }, label: t('canvas.legend.gate') },
      {
        id: 'yes',
        swatch: { edge: 'branch-yes' },
        label: t('canvas.legend.yes'),
      },
      { id: 'no', swatch: { edge: 'branch-no' }, label: t('canvas.legend.no') },
      {
        id: 'completion',
        swatch: { edge: 'completion' },
        label: t('canvas.legend.completion'),
      },
      {
        id: 'conditional',
        swatch: { node: 'dashed' },
        label: t('canvas.legend.conditional'),
      },
      { id: 'loop', swatch: { node: 'frame' }, label: t('canvas.legend.loop') },
    ],
    [t],
  );

  const hasSteps = graph.nodes.some((node) => node.kind === 'step');
  if (!hasSteps) {
    return (
      <EmptyState
        icon={Workflow}
        title={t('canvas.empty.title')}
        description={t('canvas.empty.description')}
        action={emptyAction}
      />
    );
  }

  const listProps =
    paths === null
      ? null
      : {
          paths,
          previewId,
          pinnedId,
          onPreview: setPreviewId,
          onPin: setPinnedId,
          onActivate: (nodeId: string) => onSelect(nodeId),
        };

  const panel =
    listProps !== null && pathsOpen && !compact ? (
      <AutomationPathsPanel
        id={panelId}
        onClose={() => {
          setPathsOpen(false);
          setPreviewId(null);
        }}
        {...listProps}
      />
    ) : null;
  const pill =
    compact && pinnedInfo !== undefined ? (
      <AutomationPathsPill
        info={pinnedInfo}
        onShowAll={() => {
          setPinnedId(null);
          setPreviewId(null);
        }}
      />
    ) : null;
  const corner =
    panel !== null || pill !== null ? (
      <div className="flex flex-col items-start gap-2">
        {topStart}
        {pill}
        {panel}
      </div>
    ) : (
      topStart
    );

  const canvasProps: WorkflowCanvasProps = {
    graph,
    'aria-label': t('canvas.ariaLabel'),
    layoutKey,
    selectedId,
    onSelect,
    ...(inspectorId !== undefined && { controlsId: inspectorId }),
    ...(revealId !== undefined && { revealId }),
    ...(issueCounts !== undefined && { issues: issueCounts }),
    ...(overlay !== undefined && { overlay }),
    ...(compared !== undefined && { compare: compared }),
    ...(paths !== null && { paths: paths.flowPaths }),
    highlight,
    ...(changed !== undefined && { changed }),
    ...(view !== undefined && { view }),
    ...(onViewChange !== undefined && { onViewChange }),
    framed,
    topStart: corner,
    topEnd: (
      <>
        {paths !== null && (
          <AutomationPathsButton
            count={paths.count}
            open={pathsOpen}
            controls={pathsOpen && !compact ? panelId : undefined}
            onToggle={() => {
              setPathsOpen((open) => !open);
              setPreviewId(null);
            }}
          />
        )}
        {topEnd}
      </>
    ),
    toolbar,
    legend,
    ...(onLayout !== undefined && { onLayout }),
    notice: hasCycle ? (
      <Alert
        variant="warning"
        icon={AlertTriangle}
        title={t('canvas.cycle.title')}
        description={t('canvas.cycle.description')}
        // Unframed, the canvas has no inset of its own: the warning
        // keeps the page's instead of running into the edges.
        className={framed ? 'mb-3' : 'm-4 mb-0'}
      />
    ) : undefined,
  };
  // A run recorded step by step plays back; one recorded before records
  // were kept shows where each step ended.
  const record = run?.record?.source === 'record' ? run.record : undefined;

  return (
    <>
      <RunCanvas
        record={compare === undefined ? record : undefined}
        words={run?.words ?? NO_WORDS}
        live={run?.live === true}
        canvasProps={canvasProps}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      {listProps !== null && compact && (
        <AutomationPathsSheet
          open={pathsOpen}
          onOpenChange={(open) => {
            setPathsOpen(open);
            if (!open) setPreviewId(null);
          }}
          {...listProps}
        />
      )}
    </>
  );
}

const NO_WORDS: TimelineWords = {};

/** The timeline of no run, for a chart whose record has not arrived. */
const NO_TIMELINE = buildPlaybackTimeline({
  startedAt: 0,
  spans: [],
  travels: [],
});

/**
 * The chart, and once a run's record is there, the run playing on it: the
 * record as moments on this chart (`realRunOf`), compressed into a timeline
 * a reader can follow, and the playback bar in the toolbar — opening on the
 * whole story, the run's end, with the clock on the run's real elapsed
 * time. The same chart stays mounted while the record arrives, so it never
 * lays itself out twice.
 */
function RunCanvas({
  record,
  words,
  live,
  canvasProps,
  selectedId,
  onSelect,
}: {
  record: RunRecordView | undefined;
  words: TimelineWords;
  live: boolean;
  canvasProps: WorkflowCanvasProps;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useT('automationRuns');
  const { locale } = useLocale();
  const { graph } = canvasProps;
  const [view, setView] = useState<'chart' | 'steps'>('chart');
  const timeline = useMemo(
    () =>
      record === undefined
        ? NO_TIMELINE
        : buildPlaybackTimeline(realRunOf(record, graph, words)),
    [record, graph, words],
  );
  const clock = usePlaybackClock({ timeline, live });
  const { setT } = clock;
  // A record that lands after the chart opens on its end, as one that was
  // there from the start does; a live one follows its end by itself.
  const opened = useRef(record !== undefined);
  useEffect(() => {
    if (record === undefined || opened.current) return;
    opened.current = true;
    if (!live) setT(timeline.duration);
  }, [record, live, timeline.duration, setT]);
  if (record === undefined) return <WorkflowCanvas {...canvasProps} />;
  // A run of under a minute reads in seconds ("0.4s"), a longer one on a
  // clock face ("03:12").
  const short = (record.finishedAt ?? Date.now()) - record.startedAt < 60_000;
  const formatTime = (at: number) => {
    const elapsed = Math.max(0, timeline.toReal(at) - record.startedAt);
    return short
      ? formatDuration(elapsed, locale, { style: 'narrow', maxUnits: 1 })
      : formatFlowClock(elapsed);
  };
  // How long each step worked; a step that never ran has no duration.
  const activeOf = new Map(
    record.nodes
      .filter((step) => step.status !== 'skipped')
      .map((step) => [step.path, step.activeMs]),
  );
  const rowDuration = (row: FlowTimelineRow): string | undefined => {
    if (row.kind !== 'node') return undefined;
    const active = activeOf.get(row.nodeId);
    return active === undefined
      ? undefined
      : formatDuration(active, locale, { style: 'narrow', maxUnits: 1 });
  };
  const bar = (
    <FlowPlaybackBar
      timeline={timeline}
      t={clock.t}
      onTChange={setT}
      playing={clock.playing}
      onPlayingChange={clock.setPlaying}
      speed={clock.speed}
      onSpeedChange={clock.setSpeed}
      formatTime={formatTime}
      {...(live && !clock.following && { onFollowLive: clock.follow })}
    />
  );
  // The run as a chart or as its steps in time order: one clock, so both
  // show the same moment, and switching keeps where the reader was.
  const switcher = (
    <SegmentedControl
      aria-label={t('view.label')}
      value={view}
      onValueChange={(next) => {
        if (next === 'chart' || next === 'steps') setView(next);
      }}
      options={[
        { value: 'chart', label: t('view.chart') },
        { value: 'steps', label: t('view.steps') },
      ]}
    />
  );
  if (view === 'steps') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          {switcher}
          <div className="min-w-0 flex-1">{bar}</div>
        </div>
        <FlowRunTimeline
          graph={graph}
          timeline={timeline}
          t={clock.t}
          onSeek={setT}
          selectedId={selectedId}
          onSelect={(row) => onSelect(row.nodeId ?? null)}
          formatTime={formatTime}
          formatDuration={rowDuration}
          live={live}
          className="min-h-0 flex-1"
        />
      </div>
    );
  }
  return (
    <WorkflowCanvas
      {...canvasProps}
      playback={{ timeline, t: clock.t }}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {switcher}
          {bar}
        </div>
      }
    />
  );
}
