'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { ChevronRightIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatDurationSeconds } from '@/lib/utils/format/duration';

import { humanizeNodeId, type AutomationGraph } from '../lib/graph';
import type { NodeRunView, RunProjection } from '../lib/run-view';
import { AgentActivityLine, AgentExecutionLog } from './agent-execution-log';
import { NodeStatusIcon } from './run-status-badge';
import { RunStepDetail } from './run-step-detail';

/**
 * One step of the timeline. Expansion is component state rather than a native
 * `<details>` so that a collapsed row truly costs nothing — the transcript
 * pane below subscribes to a live query and pins its own scroll, which must
 * not happen for every agent row of a long run — and so the collapsed-only
 * hint lines can actually leave when the full detail replaces them.
 */
function TimelineRow({
  nodeId,
  nodeType,
  view,
  isCurrent,
  organizationId,
  runId,
}: {
  nodeId: string;
  nodeType: string;
  /** What the run recorded about this step — synthesised for the one in
   * flight, so it is always present here. */
  view: NodeRunView;
  isCurrent: boolean;
  organizationId: string;
  runId: Id<'automationRuns'>;
}) {
  const { t } = useT('automations');
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const heading = humanizeNodeId(nodeId);

  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2',
        isCurrent
          ? 'border-primary/40 bg-primary/[0.03]'
          : 'border-border bg-card',
        // A condition turned here and the run walked past — part of the
        // path, not part of what happened.
        view.status === 'skipped' && 'opacity-60',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((value) => !value)}
        className="focus-visible:ring-ring flex w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-sm py-0.5 text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform',
            open && 'rotate-90',
          )}
        />
        <NodeStatusIcon status={view.status} />
        <span className="min-w-0 truncate text-sm font-medium">{heading}</span>
        <span className="text-muted-foreground font-mono text-[11px]">
          {nodeType}
        </span>
        {/* A skipped step's near-zero duration is clutter, not information. */}
        {view.ms !== undefined && view.status !== 'skipped' && (
          <span className="text-muted-foreground text-xs">
            {formatDurationSeconds(Math.ceil(view.ms / 1000))}
          </span>
        )}
        {view.effects.length > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {t('runs.timeline.actions', { count: view.effects.length })}
          </Badge>
        )}
      </button>
      {/* Collapsed-only hints: the failure that would otherwise hide behind a
          click, and — on the step in flight — the agent's latest move. Both
          yield to the full detail once the row is open. */}
      {!open && view.error !== undefined && (
        <Text as="p" className="text-destructive mt-1 truncate pl-6 text-xs">
          {view.error}
        </Text>
      )}
      {!open && isCurrent && nodeType === 'agent' && (
        <AgentActivityLine
          organizationId={organizationId}
          runId={runId}
          className="mt-1 pl-6"
        />
      )}
      {open && (
        <div
          id={detailId}
          className="border-border mt-2 flex flex-col gap-3 border-t pt-3 pl-6"
        >
          <RunStepDetail
            runView={view}
            heading={heading}
            {...(isCurrent ? { badge: t('runs.timeline.current') } : {})}
          />
          {/* The transcript is the AGENT step's detail — never another
              step's, and nothing at all for other types. */}
          {nodeType === 'agent' && (
            <AgentExecutionLog organizationId={organizationId} runId={runId} />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * One run as a vertical step list that GROWS with the run — a step appears
 * when the engine reaches it, in the order it was reached, and each row stays
 * compact until the reader unfolds it.
 *
 * Only the path taken is listed: steps with a recorded outcome (skipped ones
 * included — a condition turned there, which is part of the story) plus the
 * step in flight. The road ahead stays off the list — an automation's
 * document is mostly rails that never fire on a given run, and listing them
 * up front would drown the three steps that matter in twenty that will never
 * run. The engine walks the document in its topological order, so that order
 * IS the execution chronology.
 *
 * The collapsed row answers "how far along is it?" at a glance: status icon,
 * step name, duration, how many outward actions the step performed — plus,
 * on the step in flight, the agent's latest move as a live one-liner, and on
 * a failed step its error. Unfolding a row answers "what exactly happened
 * here?": the same {@link RunStepDetail} the automation editor's inspector
 * renders (resolved input, output, effects), and for an `agent` step the
 * live sandbox transcript.
 */
export function RunStepTimeline({
  graph,
  projection,
  currentNodeId,
  organizationId,
  runId,
}: {
  graph: AutomationGraph;
  projection: RunProjection;
  /** The node a live run is parked on — from the stepper's cursor. */
  currentNodeId: string | null;
  organizationId: string;
  runId: Id<'automationRuns'>;
}) {
  const { t } = useT('automations');
  // The path taken, in execution order: every node with a recorded outcome —
  // never `not_run`, which a finished run writes for nodes it ended without
  // reaching — plus the node the stepper is on right now.
  const rows = useMemo(
    () =>
      graph.nodes.filter((node) => {
        const view = projection.byNode.get(node.id);
        return (
          (view !== undefined && view.status !== 'not_run') ||
          node.id === currentNodeId
        );
      }),
    [currentNodeId, graph.nodes, projection],
  );

  if (graph.nodes.length === 0) {
    return (
      <Text as="p" variant="muted">
        {t('runs.loading')}
      </Text>
    );
  }

  if (rows.length === 0) {
    return (
      <Text as="p" variant="muted">
        {t('runs.timeline.empty')}
      </Text>
    );
  }

  return (
    <ol aria-label={t('runs.timeline.label')} className="flex flex-col gap-2">
      {rows.map((node) => {
        const isCurrent = node.id === currentNodeId;
        // The step in flight has no checkpoint yet — nothing has been
        // recorded about it, which is exactly why "not reached" would be the
        // wrong thing to say. Its view is synthesised so the reader can still
        // unfold WHICH step is running and, for an `agent` step, its
        // transcript.
        const view: NodeRunView = projection.byNode.get(node.id) ?? {
          status: 'running',
          effects: [],
          type: node.type,
        };
        return (
          <TimelineRow
            key={node.id}
            nodeId={node.id}
            nodeType={node.type}
            view={view}
            isCurrent={isCurrent}
            organizationId={organizationId}
            runId={runId}
          />
        );
      })}
    </ol>
  );
}
