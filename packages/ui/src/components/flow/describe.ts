import type { IssueCounts } from '../feedback/issue-summary';
import { flowNodeIssueText } from './node-issue-marker';
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
  /** The line along a box's foot when no run is shown. */
  strips: ReadonlyMap<string, string>;
  /** The title of a node as other sentences name it. */
  titles: ReadonlyMap<string, string>;
  /** The sentences under a node in the List view. */
  lines: ReadonlyMap<string, readonly string[]>;
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

function rowText(row: FlowRow, t: FlowTranslate): string {
  const detail = [row.detail, row.note, row.badge?.label]
    .filter(Boolean)
    .join(', ');
  return detail === ''
    ? row.label
    : t('node.rowWithDetail', { label: row.label, detail });
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
  }: {
    t: FlowTranslate;
    /** Reads the `issues` namespace (a node's problem counts). */
    tIssues: FlowTranslate;
    list: (items: readonly string[]) => string;
    issues?: ReadonlyMap<string, IssueCounts>;
  },
): FlowWords {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const titles = new Map(
    graph.nodes.map((node) => [node.id, flowNodeTitle(node, t)]),
  );
  const drawn = graph.edges.filter((edge) => !edge.layoutOnly);
  const incoming = new Map<string, FlowEdge[]>();
  const outgoing = new Map<string, FlowEdge[]>();
  for (const edge of drawn) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const isGate = (id: string) => byId.get(id)?.kind === 'gate';
  const titleOf = (id: string) => titles.get(id) ?? id;
  const unique = (ids: string[]) => [...new Set(ids)];

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
  const count = graph.nodes.length;

  graph.nodes.forEach((node, index) => {
    const issueText = flowNodeIssueText(
      tIssues,
      issues?.get(node.id) ?? NO_ISSUES,
    );
    const title = titleOf(node.id);
    const base =
      node.kind === 'gate'
        ? t('gate.name', { node: node.label, condition: node.condition })
        : title;
    names.set(node.id, issueText === '' ? base : `${base} ${issueText}`);

    const parts: (string | null | undefined)[] = [
      t('node.position', { index: index + 1, count }),
    ];
    let listLines: (string | null | undefined)[] = [];
    if (node.kind === 'step') {
      const reads = readsOf(node);
      strips.set(node.id, reads);
      parts.push(
        comesFrom(node.id),
        ...conditions(node.id),
        leadsTo(node.id),
        reads,
      );
      if (node.unreachable) parts.push(t('node.unreachable'));
      parts.push(node.description);
      listLines = [
        reads,
        ...conditions(node.id),
        leadsTo(node.id),
        node.unreachable ? t('node.unreachable') : null,
      ];
    } else if (node.kind === 'gate') {
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
      strips.set(node.id, leads ?? '');
      parts.push(leads);
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
      strips.set(node.id, from ?? '');
      parts.push(from);
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
      parts
        .filter(
          (part): part is string => typeof part === 'string' && part !== '',
        )
        .map((part) => part.replace(/[.\s]+$/u, ''))
        .join('. ')
        .concat('.'),
    );
    lines.set(
      node.id,
      listLines.filter(
        (line): line is string => typeof line === 'string' && line !== '',
      ),
    );
  });
  return { names, descriptions, strips, titles, lines };
}
