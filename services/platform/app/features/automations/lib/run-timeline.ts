/**
 * A run's record as the canvas plays it: each step's stretch of work, each
 * condition's decision, each value that travelled along a line, and each
 * wait — in real time, which the flow package compresses into a timeline a
 * reader can follow (`buildPlaybackTimeline`). Only what the graph draws is
 * played: a step inside a subautomation belongs to its node's own record,
 * and a travel along a line the graph does not have is left out.
 *
 * Words come from the caller, so this stays a pure mapping.
 */

import type {
  FlowRealRun,
  FlowRealSpan,
  FlowRealTravel,
  FlowRealWait,
} from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';

import type {
  RecordedStep,
  RunRecordView,
} from '@/app/lib/backend/contract/automations';
import type { WaitRecord } from '@/lib/engine/core/record/types';

import { gateIdOf } from './flow-ids';

/** What the timeline says in words; each left out says nothing. */
export interface TimelineWords {
  /** A step that ran per item: "12 of 50 items". */
  items?: (step: RecordedStep) => string | undefined;
  /** Why a step produced no output, in a short phrase. */
  skipped?: (step: RecordedStep) => string | undefined;
  /** The first line of why a step failed. */
  failed?: (step: RecordedStep) => string | undefined;
  /** A wait: "Waited 3 h for approval". */
  wait?: (wait: WaitRecord, step: RecordedStep) => string;
}

const FINISHED = new Set(['success', 'failed', 'cancelled']);

/** The stretch's outcome a step's status plays as; undefined for a step
 * that has not started. */
function spanOutcome(step: RecordedStep): FlowRealSpan['outcome'] | undefined {
  switch (step.status) {
    case 'succeeded':
    case 'reused':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'stopped':
      return 'stopped';
    case 'waiting':
      return 'waiting';
    case 'running':
      // Still at work: an open stretch reads running.
      return 'succeeded';
    case 'not_run':
      return 'not-run';
    default:
      return undefined;
  }
}

/** The moment a step that never ran is drawn deciding not to: its skip, or
 * the latest decision it holds. */
function decidedAt(step: RecordedStep): number | undefined {
  return step.skip?.at ?? step.decisions.at(-1)?.at;
}

/** The record of a run as real moments on the version's graph. */
export function realRunOf(
  view: RunRecordView,
  graph: FlowGraph,
  words: TimelineWords = {},
): FlowRealRun {
  const nodes = new Set(graph.nodes.map((node) => node.id));
  const edges = new Set(graph.edges.map((edge) => edge.id));
  const spans: FlowRealSpan[] = [];
  const waits: FlowRealWait[] = [];
  for (const step of view.nodes) {
    // A subautomation's steps play inside their node, not on this graph.
    if (step.parentPath !== undefined || !nodes.has(step.path)) continue;
    const outcome = spanOutcome(step);
    if (outcome === undefined) continue;
    const startedAt = step.startedAt ?? decidedAt(step);
    if (startedAt === undefined) continue;
    const reason =
      outcome === 'failed'
        ? words.failed?.(step)
        : outcome === 'skipped'
          ? words.skipped?.(step)
          : undefined;
    const detail = step.counts === undefined ? undefined : words.items?.(step);
    const open = step.status === 'running' || step.status === 'waiting';
    const endedAt = open ? undefined : (step.endedAt ?? startedAt);
    spans.push({
      nodeId: step.path,
      startedAt,
      ...(endedAt !== undefined && { endedAt }),
      outcome,
      ...(reason !== undefined && { reason }),
      ...(detail !== undefined && { detail }),
    });
    // A condition decides in the gate drawn above its step.
    const gate = gateIdOf(step.path);
    const when = step.decisions.findLast((d) => d.kind === 'when');
    if (when !== undefined && nodes.has(gate)) {
      spans.push({
        nodeId: gate,
        startedAt: when.at,
        endedAt: when.at,
        outcome: 'succeeded',
        decision: when.result,
      });
    }
    for (const wait of step.waits) {
      waits.push({
        startedAt: wait.since,
        ...(wait.until !== undefined && { endedAt: wait.until }),
        label: words.wait?.(wait, step) ?? '',
      });
    }
  }
  const travels: FlowRealTravel[] = [];
  for (const travel of view.travels ?? []) {
    const { source, target, kind } = travel.edge;
    const to = kind === 'order' ? gateIdOf(target) : target;
    const edgeId = `${source}>${to}`;
    if (!edges.has(edgeId)) continue;
    travels.push({
      edgeId,
      at: travel.at,
      target: to,
      ...(travel.item !== undefined && { item: travel.item }),
    });
  }
  const finished = FINISHED.has(view.status);
  const ends = spans.flatMap((span) =>
    span.endedAt === undefined ? [] : [span.endedAt],
  );
  return {
    startedAt: view.startedAt,
    ...(finished && {
      endedAt: view.finishedAt ?? Math.max(view.startedAt, ...ends),
    }),
    spans,
    travels,
    ...(waits.length > 0 && { waits }),
  };
}
