import type { IssueCounts } from '../feedback/issue-summary';
import { flowNodeIssueText } from './node-issue-marker';
import { FLOW_NODE_STATE } from './node-status';
import type {
  FlowCompareOverlay,
  FlowFrameState,
  FlowNodeRunInfo,
} from './playback/types';
import type { FlowEdge, FlowGraph, FlowNode, FlowRow } from './types';

/** Translates a key of the `flow` namespace (or of `issues`, with `ns`). */
export type FlowTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** What a chart says about each node, in words. */
export interface FlowWords {
  /** The accessible name: the title, the kind for Start, End and a
   *  condition, the problems. */
  names: ReadonlyMap<string, string>;
  /** The accessible description: where the node sits, what it comes from
   *  and leads to, when it runs, what it reads, and the host's sentences. */
  descriptions: ReadonlyMap<string, string>;
  /** The line along a box's foot: what it reads, or in a run how it
   *  went, or why it steps back from a highlight. */
  strips: ReadonlyMap<string, string>;
  /** The title of a node as other sentences name it. */
  titles: ReadonlyMap<string, string>;
  /** The sentences under a node in the List view. */
  lines: ReadonlyMap<string, readonly string[]>;
  /** What a pointer resting on a node reads in its tooltip: the run's
   *  explanation, one line per run compared. */
  explanations: ReadonlyMap<string, readonly string[]>;
}

const NO_ISSUES: IssueCounts = { errors: 0, warnings: 0 };

/** "and"-joined lists in the reader's language. */
export function flowListFormat(
  locale: string,
): (items: readonly string[]) => string {
  const format = new Intl.ListFormat(locale, {
    style: 'long',
    type: 'conjunction',
  });
  return (items) => format.format(items);
}

/** The words of the boxes' kinds. */
export function flowNodeTitle(node: FlowNode, t: FlowTranslate): string {
  if (node.kind === 'entry') return node.label ?? t('node.entry');
  if (node.kind === 'exit') return node.label ?? t('node.exit');
  return node.label;
}

/**
 * A node's run in words: a condition's decision, Start's and End's own
 * line, or a step's state (or the host's reason) and its detail — "Failed
 * · 1.2 s", "Running · 12 of 50 items". The node the run stopped at says so
 * when the host gave no error line.
 */
export function flowRunText(
  node: FlowNode,
  info: FlowNodeRunInfo,
  t: FlowTranslate,
  stoppedHere = false,
): string {
  const state =
    info.state === 'idle' ? '' : t(FLOW_NODE_STATE[info.state].labelKey);
  if (node.kind === 'gate')
    return info.decision === undefined
      ? state
      : t(info.decision ? 'state.decidedYes' : 'state.decidedNo');
  if (node.kind === 'entry' || node.kind === 'exit')
    return info.detail ?? info.reason ?? state;
  const words =
    info.reason ??
    (stoppedHere && info.state === 'failed' ? t('state.failedHere') : state);
  const detail =
    info.detail ??
    (info.items?.total === undefined
      ? undefined
      : t('group.items', { done: info.items.done, total: info.items.total })) ??
    (info.pass?.max === undefined
      ? undefined
      : t('group.pass', { pass: info.pass.current, max: info.pass.max }));
  return detail === undefined || detail === '' ? words : `${words} · ${detail}`;
}

/** A node's state in one word for its name; a condition's decision. */
function runName(
  node: FlowNode,
  info: FlowNodeRunInfo,
  t: FlowTranslate,
): string {
  if (node.kind === 'gate' && info.decision !== undefined)
    return t(info.decision ? 'state.decidedYes' : 'state.decidedNo');
  return info.state === 'idle' ? '' : t(FLOW_NODE_STATE[info.state].labelKey);
}

function rowText(row: FlowRow, t: FlowTranslate): string {
  const detail = [row.detail, row.note, row.badge?.label]
    .filter(Boolean)
    .join(', ');
  return detail === ''
    ? row.label
    : t('node.rowWithDetail', { label: row.label, detail });
}

/** How a node went, in words: the state for its name, its strip, the
 *  sentences its description and List view lines say, and the sentences
 *  that explain it (a tooltip's lines). */
interface RunWords {
  stateName: string;
  strip: string;
  sentences: readonly string[];
  explanations: readonly string[];
}

const NO_RUN_WORDS: RunWords = {
  stateName: '',
  strip: '',
  sentences: [],
  explanations: [],
};

/** The gates in front of each step: an only-if gate, or the if/else gate
 *  whose Yes it is — the condition the step's `when` writes. */
function gatesOf(graph: FlowGraph): Map<string, string[]> {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const gates = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (kinds.get(edge.source) !== 'gate') continue;
    if (edge.kind !== 'gate' && edge.kind !== 'branch-yes') continue;
    gates.set(edge.target, [...(gates.get(edge.target) ?? []), edge.source]);
  }
  return gates;
}

/**
 * Problems per row of the List view, which has no row for a condition: a
 * step's own, with those of the condition in front of it.
 */
export function flowStepIssues(
  graph: FlowGraph,
  issues: ReadonlyMap<string, IssueCounts> | undefined,
): ReadonlyMap<string, IssueCounts> {
  const out = new Map(issues ?? []);
  if (issues === undefined) return out;
  for (const [step, gates] of gatesOf(graph)) {
    let counts = out.get(step) ?? NO_ISSUES;
    for (const gate of gates) {
      const own = issues.get(gate);
      if (own === undefined) continue;
      counts = {
        errors: counts.errors + own.errors,
        warnings: counts.warnings + own.warnings,
      };
    }
    out.set(step, counts);
  }
  return out;
}

/**
 * Every node's name, description, strip and List view lines — one place,
 * so the chart and the List view say the same.
 */
export function describeFlowGraph(
  graph: FlowGraph,
  {
    t,
    tIssues,
    list,
    issues,
    run,
    compare,
    stoppedAt,
    reasons,
  }: {
    t: FlowTranslate;
    /** Reads the `issues` namespace (a node's problem counts). */
    tIssues: FlowTranslate;
    list: (items: readonly string[]) => string;
    issues?: ReadonlyMap<string, IssueCounts>;
    /** A run shown on the chart: every node says how it went. */
    run?: FlowFrameState | null;
    /** Two runs compared: every node says how it went in each, and whether
     *  they differ. Wins over `run`. */
    compare?: FlowCompareOverlay | null;
    /** The node the run stopped at, in focus: without an error line its
     *  strip says the run stopped here. */
    stoppedAt?: string | null;
    /** Why a node steps back from a highlight, by id: its strip says so. */
    reasons?: Readonly<Record<string, string>>;
  },
): FlowWords {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const titles = new Map(
    graph.nodes.map((node) => [node.id, flowNodeTitle(node, t)]),
  );
  const drawn = graph.edges.filter((edge) => !edge.layoutOnly);
  const guards = gatesOf(graph);
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of drawn) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const isGate = (id: string) => byId.get(id)?.kind === 'gate';
  const titleOf = (id: string) => titles.get(id) ?? id;
  const unique = (ids: string[]) => [...new Set(ids)];
  const labels =
    compare === undefined || compare === null
      ? null
      : (compare.labels ?? { a: t('compare.a'), b: t('compare.b') });

  /** How `node` went in the run shown, or in each of the two compared. */
  const runWordsOf = (node: FlowNode): RunWords => {
    if (compare !== undefined && compare !== null && labels !== null) {
      const entry = compare.nodes[node.id];
      if (entry === undefined) return NO_RUN_WORDS;
      const sides = (['a', 'b'] as const).flatMap((key) => {
        const info = entry[key];
        return info === undefined || info.state === 'idle'
          ? []
          : [{ label: labels[key], info }];
      });
      const absent =
        entry.absentIn === undefined
          ? ''
          : t('compare.absent', { label: labels[entry.absentIn] });
      const sentences = sides.map(({ label, info }) =>
        t('compare.side', { label, state: flowRunText(node, info, t) }),
      );
      return {
        stateName:
          absent !== '' ? absent : entry.differs ? t('compare.differs') : '',
        strip: [...sentences, absent].filter(Boolean).join(' · '),
        sentences: absent === '' ? sentences : [...sentences, absent],
        explanations: sides.flatMap(({ label, info }) =>
          info.explanation === undefined || info.explanation === ''
            ? []
            : [t('compare.side', { label, state: info.explanation })],
        ),
      };
    }
    const info = run?.nodes[node.id];
    if (info === undefined) return NO_RUN_WORDS;
    const stateName = runName(node, info, t);
    const runText = flowRunText(node, info, t, stoppedAt === node.id);
    return {
      stateName,
      strip: runText,
      // Said once more in the description only when it adds something to
      // the name's state word.
      sentences: runText === stateName || runText === '' ? [] : [runText],
      explanations:
        info.explanation === undefined ||
        info.explanation === '' ||
        info.explanation === runText
          ? []
          : [info.explanation],
    };
  };
  const words = new Map(graph.nodes.map((node) => [node.id, runWordsOf(node)]));

  /** "Runs only if …" / "Runs when the condition of … is false" for every
   *  condition in front of `id`. */
  const conditions = (id: string): string[] =>
    (incoming.get(id) ?? [])
      .filter((edge) => isGate(edge.source))
      .map((edge) => {
        const gate = byId.get(edge.source);
        if (gate?.kind !== 'gate') return '';
        return edge.kind === 'branch-no'
          ? t('relation.otherwise', { node: gate.label })
          : t('relation.onlyIf', { condition: gate.condition });
      })
      .filter((sentence) => sentence !== '');
  /** How the conditions in front of `id` decided, with what they read: the
   *  List view folds a condition into the node it guards. */
  const decisions = (id: string): string[] =>
    unique(
      (incoming.get(id) ?? [])
        .filter((edge) => isGate(edge.source))
        .flatMap((edge) => words.get(edge.source)?.explanations ?? []),
    );

  const comesFrom = (id: string): string | null => {
    const sources = unique(
      (incoming.get(id) ?? [])
        .filter((edge) => !isGate(edge.source))
        .map((edge) => titleOf(edge.source)),
    );
    return sources.length > 0
      ? t('relation.comesFrom', { list: list(sources) })
      : null;
  };
  const leadsTo = (id: string): string | null => {
    const targets = unique(
      (outgoing.get(id) ?? []).map((edge) => titleOf(edge.target)),
    );
    return targets.length > 0
      ? t('relation.leadsTo', { list: list(targets) })
      : null;
  };
  const readsOf = (node: FlowNode): string => {
    if (node.kind !== 'step') return '';
    if (node.reads !== undefined && node.reads.length > 0)
      return t('list.reads', {
        list: list(node.reads.map((row) => row.label)),
      });
    return node.readsEmpty ?? '';
  };
  const section = (heading: string, rows: readonly FlowRow[], empty: string) =>
    t('node.section', {
      heading,
      items: rows.length > 0 ? list(rows.map((row) => rowText(row, t))) : empty,
    });

  const names = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const strips = new Map<string, string>();
  const lines = new Map<string, readonly string[]>();
  const explanations = new Map<string, readonly string[]>();
  const count = graph.nodes.length;

  graph.nodes.forEach((node, index) => {
    const issueText = flowNodeIssueText(
      tIssues,
      issues?.get(node.id) ?? NO_ISSUES,
    );
    const title = titleOf(node.id);
    const plain =
      node.kind === 'gate'
        ? t('gate.name', { node: node.label, condition: node.condition })
        : title;
    const {
      stateName,
      strip,
      sentences,
      explanations: why,
    } = words.get(node.id) ?? NO_RUN_WORDS;
    const base =
      stateName === ''
        ? plain
        : t('node.rowWithDetail', { label: plain, detail: stateName });
    names.set(node.id, issueText === '' ? base : `${base} ${issueText}`);
    if (why.length > 0) explanations.set(node.id, why);
    const reason = reasons?.[node.id];
    const extra = [...sentences, ...why, reason ?? ''];

    const parts: (string | null | undefined)[] = [
      t('node.position', { index: index + 1, count }),
    ];
    let listLines: (string | null | undefined)[] = [];
    if (node.kind === 'step') {
      const reads = readsOf(node);
      strips.set(node.id, reason ?? (strip || reads));
      parts.push(...extra);
      parts.push(
        comesFrom(node.id),
        ...conditions(node.id),
        leadsTo(node.id),
        reads,
      );
      if (node.unreachable) parts.push(t('node.unreachable'));
      parts.push(node.description);
      listLines = [
        ...(sentences.length > 0 ? sentences : [strip]),
        ...why,
        reason,
        reads,
        ...conditions(node.id),
        ...decisions(node.id),
        // The List view has no row for a condition: its problems are said
        // on the step it guards.
        ...(guards.get(node.id) ?? []).map((gate) => {
          const gateIssues = flowNodeIssueText(
            tIssues,
            issues?.get(gate) ?? NO_ISSUES,
          );
          return gateIssues === ''
            ? null
            : t('node.rowWithDetail', {
                label: titleOf(gate),
                detail: gateIssues,
              });
        }),
        leadsTo(node.id),
        node.unreachable ? t('node.unreachable') : null,
      ];
    } else if (node.kind === 'gate') {
      parts.push(...extra);
      const out = outgoing.get(node.id) ?? [];
      const yes = out.find((edge) => edge.kind === 'branch-yes');
      const no = out.find((edge) => edge.kind === 'branch-no');
      parts.push(comesFrom(node.id), ...conditions(node.id));
      parts.push(
        node.mode === 'if-else' && yes && no
          ? t('gate.branches', {
              yes: titleOf(yes.target),
              no: titleOf(no.target),
            })
          : leadsTo(node.id),
      );
      parts.push(node.description);
    } else if (node.kind === 'entry') {
      const leads = leadsTo(node.id);
      strips.set(node.id, reason ?? (strip || (leads ?? '')));
      parts.push(...extra, leads);
      parts.push(
        node.description ??
          [
            node.triggers.length > 0
              ? section(t('node.triggers'), node.triggers, '')
              : null,
            section(
              t('node.inputs'),
              node.inputs,
              node.inputsEmpty ?? t('node.noInput'),
            ),
            node.notice?.text,
          ]
            .filter(Boolean)
            .join('. '),
      );
      listLines = [
        ...(sentences.length > 0 ? sentences : [strip]),
        ...why,
        node.triggers.length > 0
          ? section(t('node.triggers'), node.triggers, '')
          : null,
        section(
          t('node.inputs'),
          node.inputs,
          node.inputsEmpty ?? t('node.noInput'),
        ),
        node.notice?.text,
      ];
    } else {
      const from = comesFrom(node.id);
      strips.set(node.id, reason ?? (strip || (from ?? '')));
      parts.push(...extra, from);
      const outcomes = node.outcomes ?? [];
      parts.push(
        node.description ??
          [
            section(
              t('node.outputs'),
              node.outputs,
              node.outputsEmpty ?? t('node.noOutput'),
            ),
            node.shape,
            outcomes.length > 0
              ? section(t('node.outcomes'), outcomes, '')
              : null,
            node.notice?.text,
          ]
            .filter(Boolean)
            .join('. '),
      );
      listLines = [
        ...(sentences.length > 0 ? sentences : [strip]),
        ...why,
        section(
          t('node.outputs'),
          node.outputs,
          node.outputsEmpty ?? t('node.noOutput'),
        ),
        outcomes.length > 0 ? section(t('node.outcomes'), outcomes, '') : null,
        node.notice?.text,
      ];
    }
    descriptions.set(
      node.id,
      unique(
        parts.filter(
          (part): part is string => typeof part === 'string' && part !== '',
        ),
      )
        .map((part) => part.replace(/[.\s]+$/u, ''))
        .join('. ')
        .concat('.'),
    );
    lines.set(
      node.id,
      unique(
        listLines.filter(
          (line): line is string => typeof line === 'string' && line !== '',
        ),
      ),
    );
  });
  return { names, descriptions, strips, titles, lines, explanations };
}
