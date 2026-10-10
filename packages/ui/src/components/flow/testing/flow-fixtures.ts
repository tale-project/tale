import {
  Bot,
  Braces,
  CircleCheck,
  CircleX,
  Clock,
  CircleDot,
  GitPullRequest,
  Hand,
  Inbox,
  Mail,
  Send,
  Sparkles,
  Square,
} from 'lucide-react';

import type { FlowRealRun, FlowRealSpan } from '../playback/build-timeline';
import type { FlowRunOverlay } from '../playback/types';
import type {
  FlowEdge,
  FlowEdgeKind,
  FlowEntryNode,
  FlowExitNode,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowStepNode,
} from '../types';

/**
 * Graphs the flow tests, demos and stories share — each one shaped exactly
 * as a host's adapter emits it: Start first, each gate immediately before
 * the step it guards, End last, edges sorted by target then source.
 */

const edge = (
  source: string,
  target: string,
  kind: FlowEdgeKind,
  extra: Partial<FlowEdge> = {},
): FlowEdge => ({ id: `${source}>${target}`, source, target, kind, ...extra });

/** Edges in the order an adapter emits them: by target, then by source,
 *  in reading order. */
function sorted(graph: FlowGraph): FlowGraph {
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  return {
    ...graph,
    edges: [...graph.edges].sort(
      (a, b) =>
        (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0) ||
        (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0),
    ),
  };
}

const OUTCOMES: FlowExitNode['outcomes'] = [
  {
    id: 'succeeded',
    icon: CircleCheck,
    label: 'Succeeded',
    detail: 'returns the output',
  },
  {
    id: 'failed',
    icon: CircleX,
    label: 'Failed',
    detail: 'when one of its nodes fails',
  },
  {
    id: 'stopped',
    icon: Square,
    label: 'Stopped',
    detail: 'when someone stops it',
  },
];

const start = (
  inputs: FlowEntryNode['inputs'],
  triggers: FlowEntryNode['triggers'] = [
    { id: 'manual', icon: Hand, label: 'By hand, the API or MCP' },
  ],
): FlowEntryNode => ({ id: '__start', kind: 'entry', triggers, inputs });

const end = (
  outputs: FlowExitNode['outputs'],
  extra: Partial<FlowExitNode> = {},
): FlowExitNode => ({
  id: '__end',
  kind: 'exit',
  outputs,
  outcomes: OUTCOMES,
  ...extra,
});

const step = (
  id: string,
  label: string,
  extra: Partial<FlowStepNode> = {},
): FlowStepNode => ({ id, kind: 'step', label, icon: Braces, ...extra });

/** Triage GitHub issues: the long `open_issues → report` edge must run
 *  round `score`'s frame, never through it. */
export function triageFlowGraph(): FlowGraph {
  return sorted({
    nodes: [
      start(
        [
          {
            id: 'owner',
            label: 'owner',
            detail: 'text · required',
            code: true,
          },
          { id: 'repo', label: 'repo', detail: 'text · required', code: true },
          { id: 'limit', label: 'limit', detail: 'a number', code: true },
          {
            id: 'trigger',
            label: 'trigger',
            detail: 'text · from the trigger',
            code: true,
          },
          {
            id: 'firedAt',
            label: 'firedAt',
            detail: 'a number · from the trigger',
            code: true,
          },
        ],
        [
          {
            id: 'schedule',
            icon: Clock,
            label: 'Every day at 07:00 · UTC',
            note: 'Next Thu 9 Oct, 07:00',
          },
          { id: 'manual', icon: Hand, label: 'By hand, the API or MCP' },
        ],
      ),
      step('issues', 'Issues', {
        icon: CircleDot,
        typeLabel: 'GitHub · List issues',
        reads: [{ id: 'input', label: 'run input (owner, repo, limit)' }],
        returns: { text: '{ issues: object[] }', code: true },
      }),
      step('open_issues', 'Open issues', {
        typeLabel: 'Transform',
        reads: [
          { id: 'issues', label: 'Issues' },
          { id: 'input', label: 'run input (limit)' },
        ],
        returns: { text: '{ count: number; issues: object[] }', code: true },
      }),
      step('score', 'Score', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [
          { id: 'open_issues', label: 'Open issues' },
          { id: 'item', label: 'each item' },
        ],
        returns: {
          text: '{ actionable: boolean; priority: string; reason: string }[]',
          code: true,
        },
        description: 'Runs once for each item of issues of Open issues.',
      }),
      step('report', 'Report', {
        typeLabel: 'Transform',
        reads: [
          { id: 'open_issues', label: 'Open issues' },
          { id: 'score', label: 'Score' },
        ],
        returns: null,
      }),
      end([{ id: 'report', label: 'The output of Report' }], {
        shape: '{ reviewed: number; actionable: number; issues: object[] }',
      }),
    ],
    edges: [
      edge('__start', 'issues', 'entry'),
      edge('issues', 'open_issues', 'data', { detail: 'Carries .issues' }),
      edge('open_issues', 'score', 'data', { detail: 'Carries .issues' }),
      edge('open_issues', 'report', 'data', { detail: 'Carries .issues' }),
      edge('score', 'report', 'data'),
      edge('report', '__end', 'exit'),
    ],
    groups: [
      {
        id: 'each:score',
        kind: 'each',
        label: 'For each item of issues of Open issues',
        members: ['score'],
      },
    ],
  });
}

/** Review pull requests: three consecutive nodes each iterate the same
 *  list, one frame each. */
export function reviewPullRequestsFlowGraph(): FlowGraph {
  const each = (id: string): FlowGroup => ({
    id: `each:${id}`,
    kind: 'each',
    label: 'For each item of pulls of Open pulls',
    members: [id],
  });
  return sorted({
    nodes: [
      start([
        { id: 'owner', label: 'owner', detail: 'text · required', code: true },
        { id: 'repo', label: 'repo', detail: 'text · required', code: true },
      ]),
      step('pulls', 'Pulls', {
        icon: GitPullRequest,
        typeLabel: 'GitHub · List pull requests',
        reads: [{ id: 'input', label: 'run input (owner, repo)' }],
      }),
      step('open_pulls', 'Open pulls', {
        typeLabel: 'Transform',
        reads: [{ id: 'pulls', label: 'Pulls' }],
      }),
      step('diff', 'Diff', {
        icon: GitPullRequest,
        typeLabel: 'GitHub · Get pull request diff',
        reads: [{ id: 'open_pulls', label: 'Open pulls' }],
      }),
      step('review', 'Review', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-sonnet-4-5',
        reads: [
          { id: 'open_pulls', label: 'Open pulls' },
          { id: 'diff', label: 'Diff' },
        ],
      }),
      step('post', 'Post', {
        icon: GitPullRequest,
        typeLabel: 'GitHub · Create pull request review',
        reads: [
          { id: 'open_pulls', label: 'Open pulls' },
          { id: 'review', label: 'Review' },
        ],
      }),
      end([
        {
          id: 'reviewed',
          label: 'reviewed',
          detail: 'from Open pulls',
          code: true,
        },
        { id: 'reviews', label: 'reviews', detail: 'from Review', code: true },
      ]),
    ],
    edges: [
      edge('__start', 'pulls', 'entry'),
      edge('pulls', 'open_pulls', 'data'),
      edge('open_pulls', 'diff', 'data'),
      edge('open_pulls', 'review', 'data'),
      edge('diff', 'review', 'data'),
      edge('open_pulls', 'post', 'data'),
      edge('review', 'post', 'data'),
      edge('open_pulls', '__end', 'exit'),
      edge('review', '__end', 'exit'),
      edge('post', '__end', 'completion'),
    ],
    groups: [each('diff'), each('review'), each('post')],
  });
}

/** Triage inbox: an only-if gate in front of Triage, and a node that lets
 *  the run go on when it fails. */
export function triageInboxFlowGraph(): FlowGraph {
  const each = (id: string): FlowGroup => ({
    id: `each:${id}`,
    kind: 'each',
    label: 'For each item of conversations of Due',
    members: [id],
  });
  return sorted({
    nodes: [
      start([]),
      step('inbox', 'Inbox', {
        icon: Inbox,
        typeLabel: 'Conversations · List untriaged conversations',
      }),
      {
        id: '__gate:triage',
        kind: 'gate',
        label: 'Triage',
        mode: 'only-if',
        condition: 'the number of conversations of Inbox is greater than 0',
        decisionKey: 'when:triage',
      },
      step('triage', 'Triage', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [{ id: 'inbox', label: 'Inbox' }],
        conditional: true,
      }),
      step('record', 'Record', {
        icon: Inbox,
        typeLabel: 'Conversations · Record triage',
        reads: [{ id: 'triage', label: 'Triage' }],
        conditional: true,
      }),
      step('due', 'Due', {
        typeLabel: 'Transform',
        reads: [
          { id: 'inbox', label: 'Inbox' },
          { id: 'triage', label: 'Triage' },
        ],
        conditional: true,
      }),
      step('draft', 'Draft', {
        icon: Bot,
        typeLabel: 'Language model · claude-sonnet-4-5',
        reads: [{ id: 'due', label: 'Due' }],
        conditional: true,
      }),
      step('propose', 'Propose', {
        icon: Mail,
        typeLabel: 'Conversations · Draft reply',
        reads: [
          { id: 'due', label: 'Due' },
          { id: 'draft', label: 'Draft' },
        ],
        chips: [{ id: 'onError', label: 'Continues on error', tone: 'error' }],
        description: 'If it fails, the run goes on without it.',
        conditional: true,
      }),
      end([
        { id: 'read', label: 'read', detail: 'from Inbox', code: true },
        {
          id: 'summary',
          label: 'summary',
          detail: 'from Triage · may be empty',
          code: true,
        },
        {
          id: 'recorded',
          label: 'recorded',
          detail: 'from Record · may be empty',
          code: true,
        },
        {
          id: 'needsReply',
          label: 'needsReply',
          detail: 'from Due',
          code: true,
        },
        { id: 'drafted', label: 'drafted', detail: 'from Propose', code: true },
      ]),
    ],
    edges: [
      edge('__start', 'inbox', 'entry'),
      edge('inbox', '__gate:triage', 'order'),
      edge('inbox', 'triage', 'data'),
      edge('__gate:triage', 'triage', 'gate'),
      edge('triage', 'record', 'data'),
      edge('inbox', 'due', 'data'),
      edge('triage', 'due', 'data'),
      edge('due', 'draft', 'data'),
      edge('due', 'propose', 'data'),
      edge('draft', 'propose', 'data'),
      edge('inbox', '__end', 'exit'),
      edge('triage', '__end', 'exit'),
      edge('record', '__end', 'exit'),
      edge('due', '__end', 'exit'),
      edge('propose', '__end', 'exit'),
    ],
    groups: [each('draft'), each('propose')],
  });
}

/**
 * A when/elseOf pair, an else-if behind it, a node that goes on after a
 * failure and one that repeats: Yes left of No, the pair in one row.
 */
export function branchFlowGraph(): FlowGraph {
  return sorted({
    nodes: [
      start([
        {
          id: 'ticket',
          label: 'ticket',
          detail: 'an object · required',
          code: true,
        },
      ]),
      step('fetch', 'Fetch', {
        icon: Send,
        typeLabel: 'HTTP · Get',
        reads: [{ id: 'input', label: 'run input (ticket)' }],
      }),
      step('classify', 'Classify', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [{ id: 'fetch', label: 'Fetch' }],
      }),
      {
        id: '__gate:urgent',
        kind: 'gate',
        label: 'Urgent',
        mode: 'if-else',
        condition: 'urgent of Classify is true',
        decisionKey: 'when:urgent',
      },
      step('urgent', 'Urgent', {
        icon: Bot,
        typeLabel: 'Agent',
        reads: [{ id: 'fetch', label: 'Fetch' }],
        conditional: true,
      }),
      {
        id: '__gate:normal',
        kind: 'gate',
        label: 'Normal',
        mode: 'if-else',
        condition: 'nodes.classify.output.priority === "normal"',
        conditionIsCode: true,
        decisionKey: 'when:normal',
      },
      step('normal', 'Normal', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [{ id: 'fetch', label: 'Fetch' }],
        conditional: true,
      }),
      step('low', 'Low', {
        icon: Sparkles,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [{ id: 'fetch', label: 'Fetch' }],
        conditional: true,
      }),
      step('enrich', 'Enrich', {
        icon: Send,
        typeLabel: 'HTTP · Get',
        reads: [{ id: 'fetch', label: 'Fetch' }],
      }),
      step('merge', 'Merge', {
        typeLabel: 'Transform',
        reads: [
          { id: 'urgent', label: 'Urgent' },
          { id: 'normal', label: 'Normal' },
          { id: 'low', label: 'Low' },
          { id: 'enrich', label: 'Enrich' },
        ],
      }),
      step('notify', 'Notify', {
        icon: Mail,
        typeLabel: 'Email · Send',
        reads: [{ id: 'merge', label: 'Merge' }],
        chips: [{ id: 'onError', label: 'Continues on error', tone: 'error' }],
      }),
      step('poll', 'Poll', {
        icon: Send,
        typeLabel: 'HTTP · Get status',
        reads: [{ id: 'merge', label: 'Merge' }],
      }),
      end([{ id: 'merge', label: 'The output of Merge' }]),
    ],
    edges: [
      edge('__start', 'fetch', 'entry'),
      edge('fetch', 'classify', 'data'),
      edge('classify', '__gate:urgent', 'order'),
      edge('__gate:urgent', 'urgent', 'branch-yes'),
      edge('fetch', 'urgent', 'data'),
      edge('__gate:urgent', '__gate:normal', 'branch-no'),
      edge('classify', '__gate:normal', 'order'),
      edge('__gate:normal', 'normal', 'branch-yes'),
      edge('fetch', 'normal', 'data'),
      edge('__gate:normal', 'low', 'branch-no'),
      edge('fetch', 'low', 'data'),
      edge('fetch', 'enrich', 'data'),
      edge('urgent', 'merge', 'data'),
      edge('normal', 'merge', 'data'),
      edge('low', 'merge', 'data'),
      edge('enrich', 'merge', 'data'),
      edge('merge', 'notify', 'data'),
      edge('merge', 'poll', 'data'),
      edge('merge', '__end', 'exit'),
      edge('notify', '__end', 'completion'),
      edge('poll', '__end', 'completion'),
    ],
    groups: [
      {
        id: 'repeat:poll',
        kind: 'repeat',
        label: 'Repeats until done is true, at most 5×',
        members: ['poll'],
      },
    ],
  });
}

/** A gate whose condition reads only the run input: it hangs from what its
 *  node reads through layout-only edges, right above the node. */
export function inputGateFlowGraph(): FlowGraph {
  return sorted({
    nodes: [
      start([
        { id: 'notify', label: 'notify', detail: 'true or false', code: true },
      ]),
      step('load', 'Load', {
        icon: Send,
        typeLabel: 'HTTP · Get',
      }),
      step('side', 'Side', {
        typeLabel: 'Transform',
        reads: [{ id: 'load', label: 'Load' }],
      }),
      {
        id: '__gate:notify',
        kind: 'gate',
        label: 'Notify',
        mode: 'only-if',
        condition: 'notify of the run input is true',
        decisionKey: 'when:notify',
      },
      step('notify', 'Notify', {
        icon: Mail,
        typeLabel: 'Email · Send',
        reads: [{ id: 'load', label: 'Load' }],
        conditional: true,
      }),
      end([]),
    ],
    edges: [
      edge('__start', 'load', 'entry'),
      edge('load', 'side', 'data'),
      edge('load', '__gate:notify', 'order', { layoutOnly: true }),
      edge('__gate:notify', 'notify', 'gate'),
      edge('load', 'notify', 'data'),
      edge('side', '__end', 'completion'),
      edge('notify', '__end', 'completion'),
    ],
  });
}

/** A graph whose nodes read each other in a circle (an invalid document):
 *  it still lays out, with the back edge leaving at the bottom. */
export function cyclicFlowGraph(): FlowGraph {
  return sorted({
    nodes: [
      start([]),
      step('a', 'A', { typeLabel: 'Transform' }),
      step('b', 'B', { typeLabel: 'Transform' }),
      step('c', 'C', { typeLabel: 'Transform' }),
      end([]),
    ],
    edges: [
      edge('__start', 'a', 'entry'),
      edge('c', 'a', 'data'),
      edge('a', 'b', 'data'),
      edge('b', 'c', 'data'),
      edge('c', '__end', 'completion'),
    ],
  });
}

/** A document-like description the synthetic builder reads. */
export interface SyntheticDocNode {
  id: string;
  /** Nodes whose output it reads. */
  reads: readonly string[];
  /** Nodes its condition mentions; `[]` = a condition on the input. */
  when?: readonly string[];
  elseOf?: string;
  forEach?: boolean;
  repeat?: boolean;
  onErrorContinue?: boolean;
}

/**
 * The graph a host's adapter emits for `doc`, by the adapter's rules: a
 * gate before each conditional node, Yes/No for when/elseOf pairs (an
 * else-if chain hangs from the previous gate's No), Start into every root,
 * the read nodes into End and every other sink as a completion, one frame
 * per iterating node.
 */
export function flowGraphFromDoc(
  doc: readonly SyntheticDocNode[],
  outputs: readonly string[],
): FlowGraph {
  const ids = new Set(doc.map((node) => node.id));
  const byId = new Map(doc.map((node) => [node.id, node]));
  const partnerOf = new Map<string, string>();
  for (const node of doc)
    if (node.elseOf && byId.get(node.elseOf)?.when)
      partnerOf.set(node.elseOf, node.id);
  const nodes: FlowNode[] = [start([])];
  const edges: FlowEdge[] = [];
  const gateOf = (id: string) => `__gate:${id}`;
  for (const node of doc) {
    if (node.when) {
      nodes.push({
        id: gateOf(node.id),
        kind: 'gate',
        label: node.id,
        mode: partnerOf.has(node.id) ? 'if-else' : 'only-if',
        condition: `${node.id} is ready`,
        decisionKey: `when:${node.id}`,
      });
    }
    nodes.push(
      step(node.id, node.id, {
        typeLabel: 'Transform',
        reads: node.reads.map((id) => ({ id, label: id })),
        ...(node.onErrorContinue
          ? {
              chips: [
                {
                  id: 'onError',
                  label: 'Continues on error',
                  tone: 'error' as const,
                },
              ],
            }
          : {}),
      }),
    );
  }
  nodes.push(end(outputs.map((id) => ({ id, label: id }))));
  const add = (
    source: string,
    target: string,
    kind: FlowEdgeKind,
    layoutOnly = false,
  ) => {
    if (edges.some((e) => e.source === source && e.target === target)) return;
    edges.push(edge(source, target, kind, layoutOnly ? { layoutOnly } : {}));
  };
  for (const node of doc) {
    const reads = node.reads.filter((id) => ids.has(id) && id !== node.id);
    for (const source of reads) add(source, node.id, 'data');
    if (node.when) {
      const gate = gateOf(node.id);
      const sources = node.when.filter((id) => ids.has(id) && id !== node.id);
      if (sources.length > 0)
        for (const source of sources) add(source, gate, 'order');
      else if (reads.length > 0)
        for (const source of reads) add(source, gate, 'order', true);
      const partner = partnerOf.get(node.id);
      add(gate, node.id, partner ? 'branch-yes' : 'gate');
      if (partner) {
        const partnerNode = byId.get(partner);
        add(gate, partnerNode?.when ? gateOf(partner) : partner, 'branch-no');
      }
    }
    if (node.elseOf && ids.has(node.elseOf) && !byId.get(node.elseOf)?.when)
      add(node.elseOf, node.id, 'order');
  }
  const flowIds = nodes.map((node) => node.id);
  for (const id of flowIds) {
    if (id === '__start' || id === '__end') continue;
    if (!edges.some((e) => e.target === id)) add('__start', id, 'entry');
  }
  for (const id of outputs) if (ids.has(id)) add(id, '__end', 'exit');
  for (const node of doc) {
    if (!edges.some((e) => e.source === node.id && !e.layoutOnly))
      add(node.id, '__end', 'completion');
  }
  const order = new Map(flowIds.map((id, index) => [id, index]));
  edges.sort(
    (a, b) =>
      (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0) ||
      (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0),
  );
  const groups: FlowGroup[] = doc
    .filter((node) => node.forEach || node.repeat)
    .map((node) => ({
      id: `${node.forEach ? 'each' : 'repeat'}:${node.id}`,
      kind: node.forEach ? 'each' : 'repeat',
      label: node.forEach ? 'For each item of its list' : 'Repeats until done',
      members: [node.id],
    }));
  return { nodes, edges, groups };
}

/**
 * A 40-node document with conditions, if/else pairs and iterating nodes,
 * generated from a fixed seed: the size the performance budget is held at.
 */
export function syntheticDoc(count = 40, seed = 7): SyntheticDocNode[] {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const doc: SyntheticDocNode[] = [];
  for (let index = 0; index < count; index++) {
    const id = `s${String(index).padStart(2, '0')}`;
    const reads = new Set<string>();
    if (index > 0) {
      const many = 1 + Math.floor(random() * 1.7);
      for (let k = 0; k < many; k++)
        reads.add(
          doc[Math.max(0, index - 1 - Math.floor(random() * random() * 6))]
            ?.id ?? 's00',
        );
    }
    const node: SyntheticDocNode = { id, reads: [...reads] };
    if (index > 2 && random() < 0.15) node.when = [doc[index - 2]?.id ?? 's00'];
    const before = doc[index - 1];
    if (
      index > 3 &&
      !node.when &&
      random() < 0.12 &&
      before?.when &&
      !doc.some((other) => other.elseOf === before.id)
    )
      node.elseOf = before.id;
    if (random() < 0.08) node.forEach = true;
    doc.push(node);
  }
  return doc;
}

export function syntheticFlowGraph(count = 40, seed = 7): FlowGraph {
  const doc = syntheticDoc(count, seed);
  return flowGraphFromDoc(doc, [doc.at(-1)?.id ?? 's00']);
}

/** When the recorded runs below started: Thu 9 Oct 2025, 07:00 UTC. */
const RUN_STARTED = Date.UTC(2025, 9, 9, 7, 0, 0);

/**
 * A recorded run of Triage GitHub issues that fails: Score works through
 * four issues, one at a time, and the model refuses the third — Report
 * never runs. Real epoch times, as a host records them.
 */
export function triageFailedRun(): FlowRealRun {
  const at = (ms: number) => RUN_STARTED + ms;
  return {
    startedAt: at(0),
    endedAt: at(5_000),
    spans: [
      {
        nodeId: 'issues',
        startedAt: at(50),
        endedAt: at(1_250),
        outcome: 'succeeded',
        detail: '1.2 s',
      },
      {
        nodeId: 'open_issues',
        startedAt: at(1_260),
        endedAt: at(1_290),
        outcome: 'succeeded',
        detail: '30 ms',
      },
      ...[
        [1_300, 2_900],
        [2_900, 4_100],
      ].map(([from = 0, to = 0], item) => ({
        nodeId: 'score',
        startedAt: at(from),
        endedAt: at(to),
        outcome: 'succeeded' as const,
        item,
      })),
      {
        nodeId: 'score',
        startedAt: at(4_100),
        endedAt: at(5_000),
        outcome: 'failed',
        reason: 'The model provider refused the request',
        item: 2,
      },
      {
        nodeId: 'score',
        startedAt: at(5_000),
        endedAt: at(5_000),
        outcome: 'not-run',
        item: 3,
      },
    ],
    travels: [
      { edgeId: '__start>issues', at: at(0), target: 'issues' },
      {
        edgeId: 'issues>open_issues',
        at: at(1_250),
        target: 'open_issues',
        summary: '4 issues',
      },
      {
        edgeId: 'open_issues>score',
        at: at(1_290),
        target: 'score',
        summary: '4 open issues',
      },
    ],
  };
}

/**
 * A recorded run of the branch fixture that succeeds: Urgent's condition
 * says No and Normal's says Yes, so Urgent and Low are skipped; Notify
 * fails and the run goes on; Poll repeats three times; the run waits for
 * an approval on the way.
 */
export function branchRun(): FlowRealRun {
  const at = (ms: number) => RUN_STARTED + ms;
  const skipped = 'Skipped: the condition is false';
  return {
    startedAt: at(0),
    endedAt: at(4_600),
    spans: [
      {
        nodeId: 'fetch',
        startedAt: at(10),
        endedAt: at(400),
        outcome: 'succeeded',
        detail: '390 ms',
      },
      {
        nodeId: 'enrich',
        startedAt: at(410),
        endedAt: at(900),
        outcome: 'succeeded',
        detail: '490 ms',
      },
      {
        nodeId: 'classify',
        startedAt: at(410),
        endedAt: at(1_600),
        outcome: 'succeeded',
        detail: '1.2 s',
      },
      {
        nodeId: '__gate:urgent',
        startedAt: at(1_610),
        endedAt: at(1_610),
        outcome: 'succeeded',
        decision: false,
      },
      {
        nodeId: 'urgent',
        startedAt: at(1_610),
        endedAt: at(1_610),
        outcome: 'skipped',
        reason: skipped,
      },
      {
        nodeId: '__gate:normal',
        startedAt: at(1_620),
        endedAt: at(1_620),
        outcome: 'succeeded',
        decision: true,
      },
      {
        nodeId: 'low',
        startedAt: at(1_620),
        endedAt: at(1_620),
        outcome: 'skipped',
        reason: skipped,
      },
      {
        nodeId: 'normal',
        startedAt: at(1_630),
        endedAt: at(2_400),
        outcome: 'waiting',
        reason: 'Waiting for approval',
      },
      {
        nodeId: 'normal',
        startedAt: at(2_400),
        endedAt: at(3_000),
        outcome: 'succeeded',
        detail: '1.4 s',
      },
      {
        nodeId: 'merge',
        startedAt: at(3_010),
        endedAt: at(3_100),
        outcome: 'succeeded',
        detail: '90 ms',
      },
      {
        nodeId: 'notify',
        startedAt: at(3_110),
        endedAt: at(3_400),
        outcome: 'failed',
        reason: 'The mail server refused the message',
      },
      ...[1, 2, 3].map((pass) => ({
        nodeId: 'poll',
        startedAt: at(3_110 + (pass - 1) * 500),
        endedAt: at(3_110 + pass * 500),
        outcome: 'succeeded' as const,
        pass,
      })),
      {
        nodeId: '__end',
        startedAt: at(4_600),
        endedAt: at(4_600),
        outcome: 'succeeded',
        detail: 'Succeeded in 4.6 s',
      },
    ],
    travels: [
      { edgeId: '__start>fetch', at: at(0), target: 'fetch' },
      { edgeId: 'fetch>classify', at: at(400), target: 'classify' },
      { edgeId: 'fetch>enrich', at: at(400), target: 'enrich' },
      {
        edgeId: 'classify>__gate:urgent',
        at: at(1_600),
        target: '__gate:urgent',
      },
      {
        edgeId: '__gate:urgent>__gate:normal',
        at: at(1_610),
        target: '__gate:normal',
      },
      { edgeId: '__gate:normal>normal', at: at(1_620), target: 'normal' },
      { edgeId: 'fetch>normal', at: at(1_620), target: 'normal' },
      { edgeId: 'normal>merge', at: at(3_000), target: 'merge' },
      { edgeId: 'enrich>merge', at: at(3_000), target: 'merge' },
      { edgeId: 'merge>notify', at: at(3_100), target: 'notify' },
      { edgeId: 'merge>poll', at: at(3_100), target: 'poll' },
      { edgeId: 'merge>__end', at: at(4_600), target: '__end' },
      { edgeId: 'poll>__end', at: at(4_600), target: '__end' },
    ],
    waits: [
      {
        startedAt: at(1_630),
        endedAt: at(2_400),
        label: 'Waited 0.8 s for approval',
      },
    ],
  };
}

/**
 * The branch fixture's last run as an overlay — where each node ended,
 * without time: what an editor shows as "last run".
 */
export function branchRunOverlay(): FlowRunOverlay {
  const skipped = 'Skipped: the condition is false';
  return {
    finished: true,
    nodes: {
      __start: { state: 'succeeded', detail: 'Started 07:00 by hand' },
      fetch: { state: 'succeeded', detail: '390 ms' },
      enrich: { state: 'succeeded', detail: '490 ms' },
      classify: { state: 'succeeded', detail: '1.2 s' },
      '__gate:urgent': { state: 'succeeded', decision: false },
      urgent: { state: 'skipped', reason: skipped },
      '__gate:normal': { state: 'succeeded', decision: true },
      normal: { state: 'succeeded', detail: '1.4 s' },
      low: { state: 'skipped', reason: skipped },
      merge: { state: 'succeeded', detail: '90 ms' },
      notify: {
        state: 'failed',
        reason: 'The mail server refused the message',
      },
      poll: {
        state: 'succeeded',
        detail: '1.5 s',
        pass: { current: 3, max: 5 },
      },
      __end: { state: 'succeeded', detail: 'Succeeded in 4.6 s' },
    },
  };
}

/**
 * Another run of the branch fixture, to compare with `branchRunOverlay`:
 * Urgent's condition said Yes this time, so Urgent ran and Normal's
 * condition was never asked; Notify sent its message.
 */
export function branchRunOverlayB(): FlowRunOverlay {
  return {
    finished: true,
    nodes: {
      __start: { state: 'succeeded', detail: 'Started 08:00 by hand' },
      fetch: { state: 'succeeded', detail: '410 ms' },
      enrich: { state: 'succeeded', detail: '470 ms' },
      classify: { state: 'succeeded', detail: '1.1 s' },
      '__gate:urgent': {
        state: 'succeeded',
        decision: true,
        explanation: 'urgent of Classify (true) is true, so Urgent ran',
      },
      urgent: { state: 'succeeded', detail: '2.4 s' },
      merge: { state: 'succeeded', detail: '80 ms' },
      notify: { state: 'succeeded', detail: '300 ms' },
      poll: {
        state: 'succeeded',
        detail: '1 s',
        pass: { current: 2, max: 5 },
      },
      __end: { state: 'succeeded', detail: 'Succeeded in 5.1 s' },
    },
  };
}

/**
 * The failing Triage run told in full: each stretch says why it went as it
 * did (`explanation`), Score's own span knows its list holds 12 issues,
 * the run waits for an approval on Report's way and a server restart hands
 * it on — a recorded run for the Steps view and the canvas's tooltips.
 */
export function triageExplainedRun(): FlowRealRun {
  const at = (ms: number) => RUN_STARTED + ms;
  const run = triageFailedRun();
  const spans: FlowRealSpan[] = [];
  for (const span of run.spans)
    spans.push(
      span.nodeId === 'score' && span.outcome === 'failed'
        ? Object.assign({}, span, {
            explanation:
              'The model provider refused the request for the third issue: the prompt was too long.',
          })
        : span,
    );
  return {
    ...run,
    spans: [
      ...spans,
      {
        nodeId: 'score',
        startedAt: at(1_300),
        endedAt: at(5_000),
        outcome: 'failed' as const,
        total: 12,
        reason: 'The model provider refused the request',
      },
    ],
    waits: [
      {
        startedAt: at(1_260),
        endedAt: at(1_290),
        label: 'Waited 30 ms for approval (Ada)',
        nodeId: 'open_issues',
      },
    ],
    marks: [
      {
        at: at(2_900),
        kind: 'restart',
        label: 'The server restarted; another took over',
        nodeId: 'score',
      },
    ],
  };
}
