/**
 * The per-node summary and the possible paths of a run — what an editor or
 * an agent reads to see how a document behaves without running it: which
 * nodes always run, which may be skipped and why, how each one's failure is
 * handled, what each one reads and is read by, and every distinct way a
 * successful run can go.
 */

import { maxRepeatsOf } from '../execute/controlflow';
import { nodeTypes } from '../slots';
import type { Issue, NodeDef } from '../types';
import type { Shape } from '../typing/shape';
import type { RuleContext } from './context';
import type { FlowAtom, FlowFacts, PathOutcome, SkipReason } from './flow';

export type { SkipReason } from './flow';

/** What can make a node fail. */
export type FailureReason =
  | 'external'
  | 'code'
  | 'expression'
  | 'iteration'
  | 'input-contract'
  | 'subautomation';

export interface NodeAnalysis {
  id: string;
  /** Position in `doc.nodes` — the pointer is `/nodes/<index>`. */
  index: number;
  /** Position in execution order. */
  order: number;
  /** The node executes on at least one successful path. */
  reachable: boolean;
  /** The node runs on every successful path. */
  alwaysRuns: boolean;
  /** Each way the node can be skipped, with the atom it traces back to. */
  maySkip: Array<{
    reason: SkipReason;
    via?: string;
    root?: { atom: string; nodeId: string };
  }>;
  mayFail: boolean;
  failureReasons: FailureReason[];
  /** `halts`: a failure ends the run there; `continues`: the node is
   * skipped and the run goes on (onError: continue). */
  failureHandling: 'halts' | 'continues';
  iteration?:
    | { kind: 'forEach'; item: Shape }
    | { kind: 'repeat'; maxRepeats: number; static: boolean };
  reads: { data: string[]; control: string[]; elseOf?: string };
  readBy: { data: string[]; control: string[]; output: boolean };
  issues: { errors: number; warnings: number };
}

/** A successful path, with what the output reads on it. */
export type SuccessPath = PathOutcome & {
  outputReads: Array<{ nodeId: string; ran: boolean }>;
};

export interface AutomationAnalysis {
  version: 1;
  nodes: Record<string, NodeAnalysis>;
  paths: {
    atoms: readonly FlowAtom[];
    /** The first {@link MAX_LISTED_PATHS} paths, the ones with the most
     * nodes run first. */
    success: SuccessPath[];
    /** Distinct successful paths in total. */
    count: number;
    /** Nodes whose failure ends the run, with what can make them fail. */
    halts: Array<{ nodeId: string; reasons: FailureReason[] }>;
    /** Too many conditions to list the paths; the node facts come from the
     * document's structure. */
    truncated: boolean;
  };
  output: { reads: string[]; maybeEmpty: boolean };
}

/** Paths listed in full; `count` says how many there are. */
export const MAX_LISTED_PATHS = 32;

function failureReasonsOf(n: NodeDef, cx: RuleContext): FailureReason[] {
  const out: FailureReason[] = [];
  const connector = nodeTypes().get(n.type)?.connector;
  if (connector !== undefined) out.push('external', 'input-contract');
  else if (n.type === 'llm' || n.type === 'agent') out.push('external');
  else if (n.type === 'subautomation') out.push('subautomation');
  else if (n.type === 'transform') out.push('code');
  const sources = cx.sources(cx.indexOf(n));
  if (sources.some((s) => s.field !== 'code' && s.units.length > 0)) {
    out.push('expression');
  }
  if (typeof n.forEach === 'string') out.push('iteration');
  return out;
}

/** The nodes a node's `when`/`repeatUntil` read (whether or not it also
 * reads them as data). */
function controlReads(n: NodeDef, cx: RuleContext): string[] {
  const out: string[] = [];
  for (const source of cx.sources(cx.indexOf(n))) {
    if (source.data) continue;
    for (const unit of source.units) {
      for (const site of unit.refs) {
        const id = site.nodeId;
        if (id !== undefined && !out.includes(id)) out.push(id);
      }
    }
  }
  return out;
}

export function summarize(
  cx: RuleContext,
  flow: FlowFacts,
  issues: readonly Issue[],
): AutomationAnalysis {
  const outputReads: string[] = [];
  for (const source of cx.outputSources()) {
    for (const unit of source.units) {
      for (const site of unit.refs) {
        const id = site.nodeId;
        if (id !== undefined && cx.byId.has(id) && !outputReads.includes(id)) {
          outputReads.push(id);
        }
      }
    }
  }

  const reads = new Map(
    cx.nodes.map((n) => {
      const data = [...cx.refs(n).data].filter(
        (r) => cx.byId.has(r) && r !== n.id,
      );
      const control = controlReads(n, cx).filter(
        (r) => cx.byId.has(r) && r !== n.id,
      );
      return [n.id, { data, control }];
    }),
  );

  const nodes: Record<string, NodeAnalysis> = {};
  for (const n of cx.nodes) {
    const reach = flow.reach(n.id);
    const failureReasons = failureReasonsOf(n, cx);
    const own = reads.get(n.id) ?? { data: [], control: [] };
    const maySkip = flow.maySkip(n.id).map((s) => {
      const on = flow.paths.find((p) =>
        p.skipped.some(
          (k) => k.nodeId === n.id && k.reason === s.reason && k.via === s.via,
        ),
      );
      const root = on === undefined ? undefined : flow.rootCause(on, n.id)[0];
      const skip: NodeAnalysis['maySkip'][number] = { reason: s.reason };
      if (s.via !== undefined) skip.via = s.via;
      if (root !== undefined) skip.root = root;
      return skip;
    });
    const mine = issues.filter((i) => i.nodeId === n.id);
    nodes[n.id] = {
      id: n.id,
      index: cx.indexOf(n),
      order: flow.order.indexOf(n.id),
      reachable: reach.executed,
      alwaysRuns: reach.always,
      maySkip,
      mayFail: failureReasons.length > 0,
      failureReasons,
      failureHandling: n.onError === 'continue' ? 'continues' : 'halts',
      ...(typeof n.forEach === 'string'
        ? {
            iteration: {
              kind: 'forEach' as const,
              item: cx.types.nodes[n.id]?.item ?? {},
            },
          }
        : typeof n.repeatUntil === 'string'
          ? {
              iteration: {
                kind: 'repeat' as const,
                maxRepeats: maxRepeatsOf(n),
                static: mine.some((i) => i.code === 'REPEAT_UNTIL_STATIC'),
              },
            }
          : {}),
      reads: {
        data: own.data,
        control: own.control,
        ...(typeof n.elseOf === 'string' && { elseOf: n.elseOf }),
      },
      readBy: {
        data: cx.nodes
          .filter((m) => reads.get(m.id)?.data.includes(n.id))
          .map((m) => m.id),
        control: cx.nodes
          .filter((m) => reads.get(m.id)?.control.includes(n.id))
          .map((m) => m.id),
        output: outputReads.includes(n.id),
      },
      issues: {
        errors: mine.filter((i) => i.level === 'error').length,
        warnings: mine.filter((i) => i.level === 'warning').length,
      },
    };
  }

  const success: SuccessPath[] = flow.paths
    .slice(0, MAX_LISTED_PATHS)
    .map((p) =>
      Object.assign({}, p, {
        outputReads: outputReads.map((id) => ({
          nodeId: id,
          ran: flow.outcomeOf(p, id) === 'ran',
        })),
      }),
    );

  return {
    version: 1,
    nodes,
    paths: {
      atoms: flow.atoms,
      success,
      count: flow.paths.length,
      halts: flow.halts.map((h) => ({
        nodeId: h.nodeId,
        reasons: nodes[h.nodeId]?.failureReasons ?? [],
      })),
      truncated: flow.truncated,
    },
    output: {
      reads: outputReads,
      maybeEmpty: issues.some((i) => i.code === 'OUTPUT_MAYBE_EMPTY'),
    },
  };
}
