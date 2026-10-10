/**
 * A run laid over the canvas: where each node ended, which way each
 * condition decided, how the run began and how it ended.
 *
 * The run's own record (`projectRun`, `nodeStatusMap`) says what happened
 * to each node; the canvas's package derives the lines from it (a line is
 * travelled when its source succeeded and its target started) and brings
 * the way to a failure forward. A condition decided Yes when its node ran,
 * and No when its node was skipped although everything it reads ran — the
 * one skip a condition causes.
 */

import type { FlowNodeState } from '@tale/ui/flow/node-status';
import type { FlowNodeRunInfo, FlowRunOverlay } from '@tale/ui/flow/playback';
import type { FlowGraph } from '@tale/ui/flow/types';

import { formatDurationSeconds } from '@/lib/utils/format/duration';

import type { ConditionTranslate } from './condition-text';
import { END_ID, START_ID, flowGraphTarget } from './flow-ids';
import { nodeTitle } from './node-face';
import {
  flowNodeState,
  isRunFinished,
  type NodeRunStatus,
  type RunProjection,
  type RunStatus,
} from './run-view';

const RAN: ReadonlySet<FlowNodeState> = new Set([
  'succeeded',
  'failed',
  'running',
  'waiting',
]);

export interface RunOverlayInput {
  graph: FlowGraph;
  statusByNode: ReadonlyMap<string, NodeRunStatus>;
  projection: RunProjection;
  /** The run's own status: how End reads. */
  status: RunStatus;
  t: ConditionTranslate;
  /** Start's words: who or what started the run. */
  startedBy?: string;
}

/** The first line of an error: the strip has room for one. */
function firstLine(text: string): string {
  return text.split('\n', 1)[0]?.trim() ?? '';
}

/** The overlay of one run on its document's graph. */
export function runOverlay({
  graph,
  statusByNode,
  projection,
  status,
  t,
  startedBy,
}: RunOverlayInput): FlowRunOverlay {
  const finished = isRunFinished(status);
  const nodes: Record<string, FlowNodeRunInfo> = {};
  for (const [id, nodeStatus] of statusByNode) {
    const view = projection.byNode.get(id);
    // A node a finished run never reached was not run, not "not yet".
    const shown = flowNodeState(nodeStatus);
    const state = finished && shown === 'pending' ? 'not-run' : shown;
    const info: FlowNodeRunInfo = { state };
    if (
      view?.ms !== undefined &&
      (state === 'succeeded' || state === 'failed')
    ) {
      info.detail = formatDurationSeconds(Math.ceil(view.ms / 1000));
    }
    if (state === 'failed' && view?.error !== undefined) {
      const line = firstLine(view.error);
      if (line !== '') info.reason = line;
    }
    if (nodeStatus === 'interrupted') {
      info.reason = t('runs.nodeStatus.interrupted');
    }
    nodes[id] = info;
  }

  // A condition decided when its node was reached: Yes when the node
  // started, No when it was skipped while everything it reads had run.
  const dataSources = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'data' || edge.layoutOnly === true) continue;
    dataSources.set(edge.target, [
      ...(dataSources.get(edge.target) ?? []),
      edge.source,
    ]);
  }
  for (const node of graph.nodes) {
    const target = flowGraphTarget(node.id);
    if (target.kind !== 'gate') continue;
    const of = nodes[target.nodeId];
    if (of === undefined) continue;
    if (RAN.has(of.state)) {
      nodes[node.id] = { state: 'succeeded', decision: true };
    } else if (
      of.state === 'skipped' &&
      (dataSources.get(target.nodeId) ?? []).every(
        (source) => nodes[source]?.state === 'succeeded',
      )
    ) {
      nodes[node.id] = { state: 'succeeded', decision: false };
    } else {
      nodes[node.id] = {
        state: of.state === 'pending' ? 'pending' : 'not-run',
      };
    }
  }

  nodes[START_ID] = {
    state: 'succeeded',
    ...(startedBy !== undefined && startedBy !== '' && { detail: startedBy }),
  };
  const failedAt = [...statusByNode].find(
    ([, nodeStatus]) => nodeStatus === 'error',
  )?.[0];
  nodes[END_ID] =
    status === 'success'
      ? { state: 'succeeded' }
      : status === 'failed'
        ? {
            state: 'failed',
            ...(failedAt !== undefined && {
              reason: t('canvas.end.failedAt', { node: nodeTitle(failedAt) }),
            }),
          }
        : status === 'cancelled'
          ? { state: 'stopped' }
          : { state: 'pending' };

  return { nodes, finished };
}
