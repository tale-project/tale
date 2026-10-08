/**
 * The flow model: which nodes of a document run, and which are skipped and
 * why, on every way a run can go — the single source of truth for every
 * skip and reach fact the analysis states.
 *
 * A run's course is decided by two kinds of event, its ATOMS:
 *  - `when:<id>` — whether node `id`'s `when` holds when it is evaluated. A
 *    condition built from literals only (`{{ true }}`, `"{{ 1 > 2 }}"`), or
 *    text around a template (a non-empty string, so always true), is FIXED:
 *    it has one value and is never enumerated;
 *  - `fail:<id>` — whether node `id` fails, for a node with `onError:
 *    continue` only. A failure under `onError: fail` ends the run; it is a
 *    halt (`halts`), not a way the run continues.
 *
 * `simulate` replays a run for one assignment of the atoms with exactly the
 * executors' rules, in their order (both executors decide skips the same
 * way, from the same `refsOf`):
 *  1. a node that reads data from a skipped node is skipped (`upstream`);
 *  2. an `elseOf` node whose partner was not skipped by its own `when` is
 *     skipped (`else`);
 *  3. a node whose `when` is false is skipped (`when`) — the one skip an
 *     `elseOf` partner answers to;
 *  4. otherwise the node runs; failing under `onError: continue` skips it
 *     (`error`).
 *
 * The possible paths are every distinct outcome over all assignments of
 * the free atoms, found by branching only where a run consults an atom — an
 * atom of a node the run never reaches is no part of that path. With more
 * than {@link MAX_FREE_ATOMS} free atoms the paths are not enumerated
 * (`truncated`) and the facts fall back to the document's structure: a sound
 * over-approximation that may call a node skippable or reachable when no
 * actual run makes it so, and never the reverse.
 */

import { refsOf, topoSort } from '../execute/controlflow';
import { foldConstant } from '../syntax/constant';
import { parseExpressionIn } from '../syntax/parse';
import {
  conditionKind,
  exprSegments,
  tokenizeTemplate,
} from '../syntax/tokens';
import type { NodeDef } from '../types';

/** Why a node produced no output — the reasons a run records. */
export type SkipReason = 'when' | 'else' | 'upstream' | 'error';

/** Free atoms the paths are enumerated for (at most 4096 assignments). */
export const MAX_FREE_ATOMS = 12;

export interface FlowAtom {
  /** `when:<id>` or `fail:<id>`. */
  id: string;
  kind: 'when' | 'failure';
  nodeId: string;
  /** The condition has one value on every run. */
  fixed?: true;
  /** A fixed condition's value. */
  value?: boolean;
}

export interface PathSkip {
  nodeId: string;
  reason: SkipReason;
  /** upstream: the first skipped node it reads, in reading order. */
  via?: string;
}

export interface PathOutcome {
  /** Stable: the consulted free atoms in model order, e.g.
   * `when:triage=0|fail:propose=1`; `''` when the run consults none. */
  id: string;
  /** The free atoms this path consulted, and their values. */
  assignment: Record<string, boolean>;
  /** The nodes that ran, in execution order. */
  ran: string[];
  skipped: PathSkip[];
}

interface FlowNode {
  id: string;
  /** Data references in reading order — the order `refsOf` reports them. */
  data: readonly string[];
  elseOf?: string;
  when:
    | { kind: 'none' }
    | { kind: 'atom'; atom: string }
    | { kind: 'fixed'; atom: string; value: boolean };
  /** onError: continue — a failure skips the node instead of ending the
   * run. */
  failAtom?: string;
}

export interface FlowModel {
  /** The nodes in execution order (first occurrence of a duplicate id). */
  nodes: readonly FlowNode[];
  /** Every atom in execution order, a node's `when` before its failure. */
  atoms: readonly FlowAtom[];
}

export interface Reach {
  /** The node's `when` is evaluated on some path (it passed the upstream
   * and elseOf checks). */
  reached: boolean;
  /** The node's work starts on some path. */
  executed: boolean;
  /** The node produces an output on some path. */
  ran: boolean;
  /** The node produces an output on every path. */
  always: boolean;
}

export interface FlowFacts {
  atoms: readonly FlowAtom[];
  /** Node ids in execution order. */
  order: readonly string[];
  /** Every distinct successful path — the ones with the most nodes run
   * first — or none when `truncated`. */
  paths: readonly PathOutcome[];
  /** Nodes that end the run as failed when they fail (`onError: fail`),
   * among those that can start, in execution order. */
  halts: ReadonlyArray<{ nodeId: string }>;
  /** More free atoms than {@link MAX_FREE_ATOMS}: no paths, and the facts
   * below come from the document's structure. */
  truncated: boolean;
  reach(id: string): Reach;
  /** The ways node `id` can be skipped, each reason (and upstream node)
   * once. */
  maySkip(id: string): PathSkip[];
  /** Paths on which `pred` holds (none when truncated). */
  pathsWhere(pred: (p: PathOutcome) => boolean): PathOutcome[];
  /** What happened to node `id` on path `p`; undefined for a node the
   * model does not have. */
  outcomeOf(p: PathOutcome, id: string): 'ran' | SkipReason | undefined;
  /** The atoms at the root of node `id` not running on `p`: its own
   * `when` or failure, the upstream nodes' causes, or what made its elseOf
   * partner run. Empty when it ran. */
  rootCause(
    p: PathOutcome,
    id: string,
  ): Array<{ atom: string; nodeId: string }>;
}

/** The value a condition has on every run, or undefined when it depends on
 * the run. Mirrors `evalCondition`: no `{{` is one bare expression, one
 * template keeps its value, text around templates is a string. */
export function constantCondition(text: string): boolean | undefined {
  const kind = conditionKind(text);
  if (kind === 'bare') {
    const start = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    if (end <= start) return undefined;
    const parsed = parseExpressionIn(text, start, end);
    if (!parsed.ok) return undefined;
    const folded = foldConstant(parsed.ast);
    return folded.ok ? Boolean(folded.value) : undefined;
  }
  const tokens = tokenizeTemplate(text);
  const exprs = exprSegments(tokens);
  const fold = (i: number): { ok: true; value: unknown } | { ok: false } => {
    const s = exprs[i];
    const start = s.exprStart ?? s.start;
    const end = s.exprEnd ?? s.end;
    if (end <= start) return { ok: false };
    const parsed = parseExpressionIn(text, start, end);
    return parsed.ok ? foldConstant(parsed.ast) : { ok: false };
  };
  if (kind === 'single') {
    const folded = fold(0);
    return folded.ok ? Boolean(folded.value) : undefined;
  }
  // Mixed: the parts are concatenated into one string, which is non-empty —
  // so true — as soon as any literal text is in it.
  const literal = tokens.segments
    .filter((s) => s.kind === 'text')
    .some((s) => s.end > s.start);
  if (literal || exprs.length === 0) return true;
  let joined = '';
  for (let i = 0; i < exprs.length; i++) {
    const folded = fold(i);
    // A null part fails the node at run time; that is no constant.
    if (!folded.ok || folded.value === null || folded.value === undefined) {
      return undefined;
    }
    joined += typeof folded.value === 'string' ? folded.value : 'x';
  }
  return joined.length > 0;
}

/**
 * The flow model of a node list; null when the nodes reference each other
 * in a cycle (validation reports it, and no run gets past it).
 */
export function flowModel(nodes: readonly NodeDef[]): FlowModel | null {
  const unique: NodeDef[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (typeof n.id !== 'string' || seen.has(n.id)) continue;
    seen.add(n.id);
    unique.push(n);
  }
  const ordered = topoSort(unique);
  if (ordered === null) return null;
  const atoms: FlowAtom[] = [];
  const flow: FlowNode[] = ordered.map((n) => {
    const node: FlowNode = {
      id: n.id,
      data: [...refsOf(n).data],
      when: { kind: 'none' },
    };
    if (typeof n.elseOf === 'string') node.elseOf = n.elseOf;
    if (typeof n.when === 'string') {
      const atom = `when:${n.id}`;
      const value = constantCondition(n.when);
      if (value === undefined) {
        node.when = { kind: 'atom', atom };
        atoms.push({ id: atom, kind: 'when', nodeId: n.id });
      } else {
        node.when = { kind: 'fixed', atom, value };
        atoms.push({
          id: atom,
          kind: 'when',
          nodeId: n.id,
          fixed: true,
          value,
        });
      }
    }
    if (n.onError === 'continue') {
      node.failAtom = `fail:${n.id}`;
      atoms.push({ id: node.failAtom, kind: 'failure', nodeId: n.id });
    }
    return node;
  });
  return { nodes: flow, atoms };
}

interface RunState {
  skipped: Set<string>;
  whenSkipped: Set<string>;
  ran: string[];
  skips: PathSkip[];
  assignment: Record<string, boolean>;
}

function cloneState(s: RunState): RunState {
  return {
    skipped: new Set(s.skipped),
    whenSkipped: new Set(s.whenSkipped),
    ran: [...s.ran],
    skips: [...s.skips],
    assignment: { ...s.assignment },
  };
}

function finish(model: FlowModel, s: RunState): PathOutcome {
  const id = model.atoms
    .filter((a) => Object.hasOwn(s.assignment, a.id))
    .map((a) => `${a.id}=${s.assignment[a.id] ? 1 : 0}`)
    .join('|');
  return { id, assignment: s.assignment, ran: s.ran, skipped: s.skips };
}

/**
 * Run the model from node `start`. `decide` answers a free atom the run
 * consults; returning undefined makes the run branch: both values are
 * explored from that node on.
 */
function run(
  model: FlowModel,
  start: number,
  state: RunState,
  decide: (atom: string) => boolean | undefined,
  out: PathOutcome[],
): void {
  const choose = (atom: string, i: number): boolean | null => {
    if (Object.hasOwn(state.assignment, atom)) return state.assignment[atom];
    const decided = decide(atom);
    if (decided !== undefined) {
      state.assignment[atom] = decided;
      return decided;
    }
    for (const value of [true, false]) {
      const branch = cloneState(state);
      branch.assignment[atom] = value;
      run(model, i, branch, decide, out);
    }
    return null;
  };
  const skip = (id: string, reason: SkipReason, via?: string): void => {
    state.skipped.add(id);
    if (reason === 'when') state.whenSkipped.add(id);
    state.skips.push(
      via === undefined ? { nodeId: id, reason } : { nodeId: id, reason, via },
    );
  };
  for (let i = start; i < model.nodes.length; i++) {
    const n = model.nodes[i];
    const upstream = n.data.find((r) => state.skipped.has(r));
    if (upstream !== undefined) {
      skip(n.id, 'upstream', upstream);
      continue;
    }
    if (n.elseOf !== undefined && !state.whenSkipped.has(n.elseOf)) {
      skip(n.id, 'else');
      continue;
    }
    if (n.when.kind === 'fixed' && !n.when.value) {
      skip(n.id, 'when');
      continue;
    }
    if (n.when.kind === 'atom') {
      const holds = choose(n.when.atom, i);
      if (holds === null) return;
      if (!holds) {
        skip(n.id, 'when');
        continue;
      }
    }
    if (n.failAtom !== undefined) {
      const fails = choose(n.failAtom, i);
      if (fails === null) return;
      if (fails) {
        skip(n.id, 'error');
        continue;
      }
    }
    state.ran.push(n.id);
  }
  out.push(finish(model, state));
}

function emptyState(): RunState {
  return {
    skipped: new Set(),
    whenSkipped: new Set(),
    ran: [],
    skips: [],
    assignment: {},
  };
}

/**
 * Replay one run for an assignment of the free atoms. An atom the
 * assignment leaves out takes its quiet value: a `when` holds, a node does
 * not fail. The outcome's `assignment` lists the atoms the run consulted.
 */
export function simulate(
  model: FlowModel,
  assignment: Readonly<Record<string, boolean>>,
): PathOutcome {
  const out: PathOutcome[] = [];
  run(
    model,
    0,
    emptyState(),
    (atom) =>
      Object.hasOwn(assignment, atom)
        ? assignment[atom]
        : !atom.startsWith('fail:'),
    out,
  );
  return out[0];
}

/** Every distinct successful path; `truncated` (and no paths) beyond
 * {@link MAX_FREE_ATOMS} free atoms. */
export function possiblePaths(model: FlowModel): {
  paths: PathOutcome[];
  truncated: boolean;
} {
  const free = model.atoms.filter((a) => a.fixed !== true).length;
  if (free > MAX_FREE_ATOMS) return { paths: [], truncated: true };
  const out: PathOutcome[] = [];
  run(model, 0, emptyState(), () => undefined, out);
  const seen = new Set<string>();
  const paths = out.filter((p) => {
    const key = `${p.ran.join(',')}/${p.skipped.map((s) => `${s.nodeId}:${s.reason}:${s.via ?? ''}`).join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  paths.sort((a, b) =>
    a.ran.length === b.ran.length
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : b.ran.length - a.ran.length,
  );
  return { paths, truncated: false };
}

const REASON_ORDER: readonly SkipReason[] = [
  'when',
  'else',
  'upstream',
  'error',
];

function sortSkips(skips: PathSkip[]): PathSkip[] {
  return skips.sort(
    (a, b) =>
      REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason) ||
      (a.via ?? '').localeCompare(b.via ?? ''),
  );
}

interface Structural {
  canReach: boolean;
  canExecute: boolean;
  canRun: boolean;
  canWhenSkip: boolean;
  alwaysWhenSkip: boolean;
  alwaysRuns: boolean;
  skips: PathSkip[];
}

/**
 * Reach and skip facts from the document's structure alone, treating every
 * atom as independent of every other — what the facts fall back to when
 * there are too many atoms to enumerate.
 */
function structuralFacts(model: FlowModel): Map<string, Structural> {
  const facts = new Map<string, Structural>();
  for (const n of model.nodes) {
    const data = n.data
      .map((r) => ({ id: r, f: facts.get(r) }))
      .filter((x): x is { id: string; f: Structural } => x.f !== undefined);
    const neverRuns = data.find((x) => !x.f.canRun);
    if (neverRuns !== undefined) {
      facts.set(n.id, {
        canReach: false,
        canExecute: false,
        canRun: false,
        canWhenSkip: false,
        alwaysWhenSkip: false,
        alwaysRuns: false,
        skips: [{ nodeId: n.id, reason: 'upstream', via: neverRuns.id }],
      });
      continue;
    }
    const mayUpstream = data.filter((x) => !x.f.alwaysRuns);
    let elsePass: 'never' | 'maybe' | 'always' = 'always';
    if (n.elseOf !== undefined) {
      const partner = facts.get(n.elseOf);
      elsePass =
        partner === undefined || !partner.canWhenSkip
          ? 'never'
          : partner.alwaysWhenSkip
            ? 'always'
            : 'maybe';
    }
    const whenPass: 'never' | 'maybe' | 'always' =
      n.when.kind === 'none'
        ? 'always'
        : n.when.kind === 'fixed'
          ? n.when.value
            ? 'always'
            : 'never'
          : 'maybe';
    const canReach = elsePass !== 'never';
    const canExecute = canReach && whenPass !== 'never';
    const alwaysRuns =
      mayUpstream.length === 0 &&
      elsePass === 'always' &&
      whenPass === 'always' &&
      n.failAtom === undefined;
    const skips: PathSkip[] = mayUpstream.map((x) => ({
      nodeId: n.id,
      reason: 'upstream' as const,
      via: x.id,
    }));
    if (elsePass !== 'always') skips.push({ nodeId: n.id, reason: 'else' });
    if (canReach && whenPass !== 'always') {
      skips.push({ nodeId: n.id, reason: 'when' });
    }
    if (canExecute && n.failAtom !== undefined) {
      skips.push({ nodeId: n.id, reason: 'error' });
    }
    facts.set(n.id, {
      canReach,
      canExecute,
      canRun: canExecute,
      canWhenSkip: canReach && whenPass !== 'always',
      alwaysWhenSkip:
        mayUpstream.length === 0 &&
        elsePass === 'always' &&
        whenPass === 'never',
      alwaysRuns,
      skips: sortSkips(skips),
    });
  }
  return facts;
}

const NO_REACH: Reach = Object.freeze({
  reached: false,
  executed: false,
  ran: false,
  always: false,
});

/** The flow facts of a model (see the module doc). */
function flowFacts(model: FlowModel): FlowFacts {
  const { paths, truncated } = possiblePaths(model);
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const outcomes = new WeakMap<PathOutcome, Map<string, 'ran' | SkipReason>>();
  const outcomeTable = (p: PathOutcome): Map<string, 'ran' | SkipReason> => {
    let table = outcomes.get(p);
    if (table === undefined) {
      table = new Map<string, 'ran' | SkipReason>();
      for (const id of p.ran) table.set(id, 'ran');
      for (const s of p.skipped) table.set(s.nodeId, s.reason);
      outcomes.set(p, table);
    }
    return table;
  };
  const outcomeOf = (p: PathOutcome, id: string) => outcomeTable(p).get(id);

  const reachOf = new Map<string, Reach>();
  const skipsOf = new Map<string, PathSkip[]>();
  if (truncated) {
    for (const [id, f] of structuralFacts(model)) {
      reachOf.set(id, {
        reached: f.canReach,
        executed: f.canExecute,
        ran: f.canRun,
        always: f.alwaysRuns,
      });
      skipsOf.set(id, f.skips);
    }
  } else {
    // One pass over the paths: what each node did on any of them.
    const ranOn = new Map<string, number>();
    const seen = new Map<string, Map<string, PathSkip>>();
    for (const n of model.nodes) {
      reachOf.set(n.id, {
        reached: false,
        executed: false,
        ran: false,
        always: false,
      });
      seen.set(n.id, new Map());
    }
    for (const p of paths) {
      for (const id of p.ran) {
        const r = reachOf.get(id);
        if (r === undefined) continue;
        r.reached = true;
        r.executed = true;
        r.ran = true;
        ranOn.set(id, (ranOn.get(id) ?? 0) + 1);
      }
      for (const s of p.skipped) {
        const r = reachOf.get(s.nodeId);
        if (r === undefined) continue;
        if (s.reason === 'when' || s.reason === 'error') r.reached = true;
        if (s.reason === 'error') r.executed = true;
        seen.get(s.nodeId)?.set(`${s.reason}:${s.via ?? ''}`, s);
      }
    }
    for (const [id, r] of reachOf) {
      r.always = paths.length > 0 && ranOn.get(id) === paths.length;
      skipsOf.set(id, sortSkips([...(seen.get(id)?.values() ?? [])]));
    }
  }

  const rootCause = (
    p: PathOutcome,
    id: string,
  ): Array<{ atom: string; nodeId: string }> => {
    const found = new Map<string, { atom: string; nodeId: string }>();
    const visit = (nodeId: string, seen: Set<string>): void => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      const n = byId.get(nodeId);
      if (n === undefined) return;
      const add = (atom: string) => found.set(atom, { atom, nodeId });
      switch (outcomeOf(p, nodeId)) {
        case 'when':
          add(`when:${nodeId}`);
          return;
        case 'error':
          if (n.failAtom !== undefined) add(n.failAtom);
          return;
        case 'upstream':
          for (const r of n.data) {
            const o = outcomeOf(p, r);
            if (o !== undefined && o !== 'ran') visit(r, seen);
          }
          return;
        case 'else': {
          const partner =
            n.elseOf === undefined ? undefined : byId.get(n.elseOf);
          if (partner === undefined) return;
          const o = outcomeOf(p, partner.id);
          if (o === 'ran' || o === 'error') {
            // The partner's `when` held (or it has none, and always runs).
            if (partner.when.kind !== 'none') {
              found.set(`when:${partner.id}`, {
                atom: `when:${partner.id}`,
                nodeId: partner.id,
              });
            }
            if (o === 'error') visit(partner.id, seen);
            return;
          }
          visit(partner.id, seen);
          return;
        }
        default:
          return;
      }
    };
    visit(id, new Set());
    return [...found.values()];
  };

  const halts = model.nodes
    .filter((n) => n.failAtom === undefined && reachOf.get(n.id)?.executed)
    .map((n) => ({ nodeId: n.id }));

  return {
    atoms: model.atoms,
    order: model.nodes.map((n) => n.id),
    paths,
    halts,
    truncated,
    reach: (id) => ({ ...(reachOf.get(id) ?? NO_REACH) }),
    maySkip: (id) => [...(skipsOf.get(id) ?? [])],
    pathsWhere: (pred) => paths.filter(pred),
    outcomeOf,
    rootCause,
  };
}

/** The flow facts of a node list; null on a reference cycle. */
export function analyzeFlow(nodes: readonly NodeDef[]): FlowFacts | null {
  const model = flowModel(nodes);
  return model === null ? null : flowFacts(model);
}
