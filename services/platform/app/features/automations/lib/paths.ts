/**
 * The possible paths of an automation, as the canvas's Paths list shows
 * them and the chart highlights them.
 *
 * The flow analysis (`analyzeFlow`, the same code the server's check runs)
 * replays a run for every way its conditions and tolerated failures can
 * go, and keeps each distinct outcome: which nodes run, which are skipped
 * and why. It runs in the browser on the document on screen, so every
 * viewer sees the paths of every version at once, without asking the
 * server. Only the reasons a node can fail come from the server's check,
 * when it has answered.
 *
 * A path row says how many nodes run and the decisions that make it
 * ("Triage runs", "Propose fails, the run goes on"); pointing at it
 * previews it on the chart, pinning it keeps it there — the rest steps
 * back, each skipped node saying why. A second section lists the nodes
 * that end a run when they fail.
 */

import type {
  FlowPathClause,
  FlowPathListRow,
  FlowPathListSection,
} from '@tale/ui/flow/flow-path-list';
import {
  highlightForNodes,
  highlightForPaths,
  type FlowHighlight,
  type FlowPath,
} from '@tale/ui/flow/paths';
import type { FlowGraph } from '@tale/ui/flow/types';

import type { FlowFacts, PathOutcome } from '@/lib/engine/core/analysis/flow';
import { MAX_LISTED_PATHS } from '@/lib/engine/core/analysis/summary';

import type { ConditionTranslate } from './condition-text';
import { decisionKeyOf, flowGraphTarget, gateIdOf } from './flow-ids';
import { nodeTitle } from './node-face';

/** What can make a node fail, as the server's check names it, in words;
 *  null for a reason a newer server names and this build has no words
 *  for. */
export function failureReasonWords(
  reason: string,
  t: ConditionTranslate,
): string | null {
  switch (reason) {
    case 'external':
      return t('failureReason.external');
    case 'code':
      return t('failureReason.code');
    case 'expression':
      return t('failureReason.expression');
    case 'iteration':
      return t('failureReason.iteration');
    case 'input-contract':
      return t('failureReason.inputContract');
    case 'subautomation':
      return t('failureReason.subautomation');
    default:
      return null;
  }
}

const PATHS_SECTION = 'paths';
const HALTS_SECTION = 'halts';

const HALT_PREFIX = 'halt:';

export interface PathRowInfo {
  /** Counted from one, as the list names it. */
  index: number;
  ran: number;
  total: number;
}

export interface AutomationPaths {
  /** Every distinct successful path, for the chart's hover on a
   *  condition or a Yes or No. */
  flowPaths: readonly FlowPath[];
  /** The Paths list: the paths, then the nodes that end a run when they
   *  fail. */
  sections: readonly FlowPathListSection[];
  /** Distinct successful paths in total (none listed when `truncated`). */
  count: number;
  /** Too many conditions to list the paths. */
  truncated: boolean;
  /** The row of each listed path. */
  rows: ReadonlyMap<string, PathRowInfo>;
  /** What the chart brings forward for a row; `pinned` adds the sentence
   *  a screen reader hears once. */
  highlightFor(rowId: string, pinned: boolean): FlowHighlight | null;
  /** The nodes that run on a path row, for End's "empty on this path". */
  ranOn(rowId: string): ReadonlySet<string> | null;
  /** The node a halting-node row stands for. */
  haltNode(rowId: string): string | null;
}

export interface PathsContext {
  t: ConditionTranslate;
  locale: string;
  /** Each node's `elseOf`, for "Skipped: Urgent runs". */
  elseOf: (nodeId: string) => string | undefined;
  /** What can make each halting node fail, when the server said. */
  halts?: ReadonlyArray<{ nodeId: string; reasons: readonly string[] }>;
}

/** The nodes and conditions a path goes through, and how each condition
 *  decided. A condition is on a path when it was evaluated there: its
 *  node ran, failed after it, or was skipped by it. */
function flowPathOf(
  flow: FlowFacts,
  path: PathOutcome,
  id: string,
  gated: ReadonlySet<string>,
): FlowPath {
  const nodes: string[] = [...path.ran];
  const decisions: Record<string, boolean> = {};
  for (const nodeId of flow.order) {
    if (!gated.has(nodeId)) continue;
    const outcome = flow.outcomeOf(path, nodeId);
    if (outcome === 'ran' || outcome === 'when' || outcome === 'error') {
      nodes.push(gateIdOf(nodeId));
      decisions[decisionKeyOf(nodeId)] = outcome !== 'when';
    }
  }
  return { id, nodes, decisions };
}

/** The Paths list and the highlights of one document's flow. */
export function automationPaths(
  flow: FlowFacts,
  graph: FlowGraph,
  ctx: PathsContext,
): AutomationPaths {
  const { t } = ctx;
  const gated = new Set(
    graph.nodes.flatMap((node) => {
      const target = flowGraphTarget(node.id);
      return target.kind === 'gate' ? [target.nodeId] : [];
    }),
  );
  const total = flow.order.length;
  const pathId = (index: number) => `path:${index + 1}`;
  const flowPaths = flow.paths.map((path, index) =>
    flowPathOf(flow, path, pathId(index), gated),
  );
  const byId = new Map(
    flow.paths.map((path, index) => [pathId(index), { path, index }]),
  );
  const atomOrder = new Map(flow.atoms.map((atom, index) => [atom.id, index]));
  const atomsById = new Map(flow.atoms.map((atom) => [atom.id, atom]));

  const rows = new Map<string, PathRowInfo>();
  const pathRows: FlowPathListRow[] = [];
  const listed =
    flow.paths.length > 1 ? flow.paths.slice(0, MAX_LISTED_PATHS) : [];
  listed.forEach((path, index) => {
    const id = pathId(index);
    const info = { index: index + 1, ran: path.ran.length, total };
    rows.set(id, info);
    const clauses = Object.entries(path.assignment)
      .sort(([a], [b]) => (atomOrder.get(a) ?? 0) - (atomOrder.get(b) ?? 0))
      .flatMap(([atomId, value]): FlowPathClause[] => {
        const atom = atomsById.get(atomId);
        if (atom === undefined) return [];
        const node = nodeTitle(atom.nodeId);
        if (atom.kind === 'when') {
          return [
            {
              id: atomId,
              label: value
                ? t('paths.clause.runs', { node })
                : t('paths.clause.skipped', { node }),
              tone: value ? 'positive' : 'negative',
            },
          ];
        }
        return [
          {
            id: atomId,
            label: value
              ? t('paths.clause.fails', { node })
              : t('paths.clause.succeeds', { node }),
            tone: value ? 'error' : 'neutral',
          },
        ];
      });
    pathRows.push({
      id,
      title: t('paths.row', { index: info.index }),
      meta: t('paths.rowRuns', { ran: info.ran, total }),
      ...(clauses.length > 0 && { clauses }),
    });
  });

  const freeAtoms = flow.atoms.filter((atom) => atom.fixed !== true).length;
  const footer = flow.truncated
    ? t('paths.truncated', { count: freeAtoms })
    : flow.paths.length === 1
      ? t('paths.single', { count: flow.paths[0]?.ran.length ?? 0 })
      : flow.paths.length > MAX_LISTED_PATHS
        ? t('paths.more', { count: flow.paths.length - MAX_LISTED_PATHS })
        : undefined;

  const reasonsOf = new Map(
    (ctx.halts ?? []).map((halt) => [halt.nodeId, halt.reasons]),
  );
  const haltIds = flow.halts.map((halt) => halt.nodeId);
  const either = new Intl.ListFormat(ctx.locale, { type: 'disjunction' });
  const haltRows: FlowPathListRow[] = haltIds.map((nodeId) => {
    const words = (reasonsOf.get(nodeId) ?? []).flatMap((reason) => {
      const text = failureReasonWords(reason, t);
      return text === null ? [] : [text];
    });
    const node = nodeTitle(nodeId);
    return {
      id: `${HALT_PREFIX}${nodeId}`,
      title:
        words.length === 0
          ? node
          : t('paths.halts.row', { node, reasons: either.format(words) }),
      pinnable: false,
    };
  });

  const sections: FlowPathListSection[] = [
    {
      id: PATHS_SECTION,
      rows: pathRows,
      ...(footer !== undefined && { footer }),
    },
    {
      id: HALTS_SECTION,
      title: t('paths.halts.title'),
      rows: haltRows,
    },
  ];

  const skipReason = (
    nodeId: string,
    skip: PathOutcome['skipped'][number],
  ): string => {
    switch (skip.reason) {
      case 'when':
        return t('paths.skip.when');
      case 'else': {
        const partner = ctx.elseOf(nodeId);
        return t('paths.skip.else', {
          node: nodeTitle(partner ?? nodeId),
        });
      }
      case 'upstream':
        return t('paths.skip.upstream', {
          node: nodeTitle(skip.via ?? nodeId),
        });
      default:
        // `error`: it failed and the run went on without it.
        return t('paths.skip.error');
    }
  };

  return {
    flowPaths,
    sections,
    count: flow.paths.length,
    truncated: flow.truncated,
    rows,
    highlightFor(rowId, pinned) {
      if (rowId.startsWith(HALT_PREFIX)) {
        return highlightForNodes(graph, haltIds, { tone: 'error' });
      }
      const found = byId.get(rowId);
      const flowPath = flowPaths[found?.index ?? -1];
      if (found === undefined || flowPath === undefined) return null;
      const reasons: Record<string, string> = {};
      for (const skip of found.path.skipped) {
        reasons[skip.nodeId] = skipReason(skip.nodeId, skip);
      }
      const info = rows.get(rowId);
      return {
        ...highlightForPaths(graph, [flowPath]),
        reasons,
        ...(pinned &&
          info !== undefined && {
            announcement: t('paths.showing', {
              index: info.index,
              ran: info.ran,
              total,
            }),
          }),
      };
    },
    ranOn(rowId) {
      const found = byId.get(rowId);
      return found === undefined ? null : new Set(found.path.ran);
    },
    haltNode(rowId) {
      return rowId.startsWith(HALT_PREFIX)
        ? rowId.slice(HALT_PREFIX.length)
        : null;
    },
  };
}
