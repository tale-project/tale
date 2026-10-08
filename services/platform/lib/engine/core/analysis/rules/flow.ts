/**
 * Findings built on the flow facts (`../flow`): which nodes run on which
 * ways a run can go.
 *
 * A node that reads a skipped node's DATA is skipped too, so a skip only
 * hurts where a read is not data: a `when`, a `repeatUntil` and the
 * automation `output`. There a skipped node's output is null, and reading a
 * field of it (`nodes.x.output.items`, `nodes.x.output[key]` — any member
 * past `.output` that no earlier `?.` of the same chain short-circuits, and
 * no `&&`/`?:` test of the same output guards) throws. So does a read whose
 * missing value lands whole inside text: `{{ nodes.x.output }}` and
 * `{{ nodes.x.output?.summary }}` alike, since text refuses null and
 * undefined. `??`, `||` and `typeof` around a member read do not help: the
 * member read throws before they see a value.
 *
 *  - MAYBE_NULL — on some way the run can go, the read is evaluated while
 *    its node did not run, and no such way traces back to a failure.
 *  - UNCAUGHT_FAILURE — the same, where on some such way the node did not
 *    run because a node with `onError: continue` failed: the failure the
 *    author chose to tolerate fails the node (or the run) anyway, with a
 *    less helpful error.
 *  - UNREACHABLE — no way the run can go executes the node.
 *  - OUTPUT_MAYBE_EMPTY — the output reads nodes, and on some way the run
 *    can go none of them runs.
 *  - UNUSED_NODE (`readers-unreachable`) — a node read only by nodes that
 *    can never run.
 */

import type { Node } from 'estree';
import { walk } from 'zimmerframe';

import { warn } from '../../errors';
import { nodeTypes } from '../../slots';
import { ptr } from '../../syntax/pointer';
import type { ExprSource, ExprUnit } from '../../syntax/sources';
import { renderPath, type PathStep, type RefSite } from '../../syntax/walk';
import type { Issue, NodeDef, RelatedLocation } from '../../types';
import { kindsOf, nullability } from '../../typing/shape';
import { isMixedText, nodeParam, place, type RuleContext } from '../context';
import type { FlowFacts, PathOutcome, SkipReason } from '../flow';

/** Fields where a skipped node's output is read as it is (null). */
const NULL_READ_FIELDS: ReadonlySet<string> = new Set([
  'when',
  'repeatUntil',
  'output',
]);

type ReadKind = 'deref' | 'interpolated';

/**
 * Whether reading the members after `.output` throws when the output is
 * null: some member is read with `.` while no `?.` before it, in the same
 * chain, has short-circuited. A `?.` inside parentheses ends with them, so
 * `(nodes.x.output?.a).b` reads `.b` of undefined.
 */
function derefsNull(site: RefSite): boolean {
  const steps: Array<Pick<PathStep, 'optional' | 'afterChain'>> = [
    ...site.path,
  ];
  if (site.dynamicTail === true) {
    steps.push({
      optional: site.dynamicTailOptional === true,
      ...(site.dynamicTailAfterChain === true && { afterChain: true }),
    });
  }
  let shortCircuits = false;
  for (const step of steps) {
    if (step.afterChain === true) shortCircuits = false;
    if (step.optional) shortCircuits = true;
    else if (!shortCircuits) return true;
  }
  return false;
}

/** The outermost node that hands the read's value on as it is: the chain,
 * a call of it, and members of either. */
function handedOn(
  unit: ExprUnit,
  site: RefSite,
): { node: Node; ancestors: Node[] } | null {
  if (!unit.parse.ok) return null;
  const at = ancestorsOf(unit.parse.ast, site.range);
  if (at === null) return null;
  let child = at.chain;
  let k = at.ancestors.length - 1;
  for (; k >= 0; k--) {
    const a = at.ancestors[k];
    const passes =
      a.type === 'ChainExpression' ||
      (a.type === 'MemberExpression' && a.object === child) ||
      (a.type === 'CallExpression' && a.callee === child);
    if (!passes) break;
    child = a;
  }
  return { node: child, ancestors: at.ancestors.slice(0, k + 1) };
}

/** How a site reads a node's output where a null breaks the read; null
 * when it does not. */
function nullRead(
  site: RefSite,
  unit: ExprUnit,
  mixed: boolean,
): ReadKind | null {
  if (site.root !== 'nodes' || site.member !== 'output') return null;
  if (derefsNull(site)) {
    if (
      site.guards.includes('and-guarded') ||
      site.guards.includes('ternary-guarded')
    ) {
      return null;
    }
    return 'deref';
  }
  // The read gives null (or, through `?.`, undefined) for a skipped node.
  // Only text refuses that, and only when the value is the whole
  // expression: `{{ nodes.x.output?.summary }}`, not `{{ … ?? '' }}`.
  if (!mixed || site.guards.some((g) => g !== 'optional-chain')) return null;
  const value = handedOn(unit, site);
  return value !== null && value.ancestors.length === 0 ? 'interpolated' : null;
}

/** The computed member the walk could not name (`[input.k]` in
 * `nodes.x.output[input.k]`): its key as the author wrote it, and the range
 * of the read through it. */
interface DynamicMember {
  key: string;
  range: [number, number];
}

function dynamicMember(
  unit: ExprUnit,
  site: RefSite,
): DynamicMember | undefined {
  if (site.dynamicTail !== true || !unit.parse.ok) return undefined;
  const at = ancestorsOf(unit.parse.ast, site.range);
  if (at === null) return undefined;
  let child = at.chain;
  for (let k = at.ancestors.length - 1; k >= 0; k--) {
    const a = at.ancestors[k];
    if (a.type === 'MemberExpression' && a.object === child && a.computed) {
      const key = a.property.range;
      const read = a.range;
      if (key === undefined || read === undefined) return undefined;
      return {
        key: unit.source.slice(key[0] - unit.range[0], key[1] - unit.range[0]),
        range: [read[0], read[1]],
      };
    }
    if (a.type !== 'ChainExpression') return undefined;
    child = a;
  }
  return undefined;
}

/** The guarded spelling of a read, for the hint: every member after
 * `.output` behind one `?.`, then the fallback. */
function guarded(
  site: RefSite,
  kind: ReadKind,
  fallback: 'false' | 'null',
  dynamic: DynamicMember | undefined,
): string {
  const tail = `${renderPath(site.path)}${
    site.dynamicTail === true ? `[${dynamic?.key ?? '…'}]` : ''
  }`;
  const read =
    tail === ''
      ? `nodes.${site.nodeId}.output`
      : `nodes.${site.nodeId}.output?${tail.startsWith('[') ? '.' : ''}${tail}${site.called === true ? '(…)' : ''}`;
  return `${read} ?? ${kind === 'interpolated' ? "''" : fallback}`;
}

/** What the branch an expression sits in says about a node: it ran, or it
 * did not. */
interface RanFact {
  nodeId: string;
  ran: boolean;
}

/** The ancestors of the member chain at `range`, root first; null when no
 * chain sits exactly there. */
function ancestorsOf(
  ast: Node,
  range: readonly [number, number],
): { chain: Node; ancestors: Node[] } | null {
  let found: { chain: Node; ancestors: Node[] } | null = null;
  walk<Node, null>(ast, null, {
    _(node, { next, path, stop }) {
      const r = node.range;
      if (
        r !== undefined &&
        r[0] === range[0] &&
        r[1] === range[1] &&
        (node.type === 'ChainExpression' ||
          node.type === 'MemberExpression' ||
          node.type === 'Identifier')
      ) {
        found = { chain: node, ancestors: [...path] };
        stop();
        return;
      }
      next();
    },
  });
  return found;
}

/** `nodes.<id>.output…` read as a value: the node, and whether the read is
 * the output itself (`bare`) rather than a member of it. */
function outputRead(expr: Node): { nodeId: string; bare: boolean } | null {
  let e: Node = expr.type === 'ChainExpression' ? expr.expression : expr;
  let depth = 0;
  const keys: string[] = [];
  while (e.type === 'MemberExpression') {
    const p = e.property;
    const key =
      !e.computed && p.type === 'Identifier'
        ? p.name
        : p.type === 'Literal' &&
            (typeof p.value === 'string' || typeof p.value === 'number')
          ? String(p.value)
          : undefined;
    if (key === undefined) return null;
    keys.unshift(key);
    depth++;
    e = e.object.type === 'ChainExpression' ? e.object.expression : e.object;
  }
  if (e.type !== 'Identifier' || e.name !== 'nodes') return null;
  if (keys.length < 2 || keys[1] !== 'output') return null;
  return { nodeId: keys[0], bare: depth === 2 };
}

/** Whether a node's output, when it ran, is truthy whatever it holds. */
function alwaysTruthy(cx: RuleContext, id: string): boolean {
  const shape = cx.types.nodes[id]?.output;
  const kinds = shape === undefined ? null : kindsOf(shape);
  return (
    kinds !== null &&
    kinds.size > 0 &&
    [...kinds].every((k) => k === 'object' || k === 'array')
  );
}

function truthyFacts(cx: RuleContext, test: Node): RanFact[] {
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return falsyFacts(cx, test.argument);
  }
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return [...truthyFacts(cx, test.left), ...truthyFacts(cx, test.right)];
  }
  // A skipped node's output is null, so a truthy read of it means it ran.
  const read = outputRead(test);
  return read === null ? [] : [{ nodeId: read.nodeId, ran: true }];
}

function falsyFacts(cx: RuleContext, test: Node): RanFact[] {
  if (test.type === 'UnaryExpression' && test.operator === '!') {
    return truthyFacts(cx, test.argument);
  }
  if (test.type === 'LogicalExpression' && test.operator === '||') {
    return [...falsyFacts(cx, test.left), ...falsyFacts(cx, test.right)];
  }
  // A falsy output is a skipped node only when a ran output is never falsy.
  const read = outputRead(test);
  return read !== null && read.bare && alwaysTruthy(cx, read.nodeId)
    ? [{ nodeId: read.nodeId, ran: false }]
    : [];
}

function nullishFacts(cx: RuleContext, test: Node): RanFact[] {
  const read = outputRead(test);
  if (read === null || !read.bare) return [];
  const shape = cx.types.nodes[read.nodeId]?.output;
  return shape !== undefined &&
    kindsOf(shape) !== null &&
    nullability(shape) === 'never'
    ? [{ nodeId: read.nodeId, ran: false }]
    : [];
}

/**
 * What the branches around a read imply about the nodes that ran when the
 * read is evaluated: `a ? READ : b` runs READ only when `a` was truthy,
 * `nodes.s.output ? x : READ` only when `s` did not run (its output, an
 * object, is otherwise truthy), `a && READ`, `a || READ`, `a ?? READ` alike.
 */
function branchFacts(
  cx: RuleContext,
  unit: ExprUnit,
  site: RefSite,
): RanFact[] {
  if (!unit.parse.ok) return [];
  const at = ancestorsOf(unit.parse.ast, site.range);
  if (at === null) return [];
  const facts: RanFact[] = [];
  let child = at.chain;
  for (let k = at.ancestors.length - 1; k >= 0; k--) {
    const a = at.ancestors[k];
    if (a.type === 'ConditionalExpression') {
      if (a.consequent === child) facts.push(...truthyFacts(cx, a.test));
      else if (a.alternate === child) facts.push(...falsyFacts(cx, a.test));
    } else if (a.type === 'LogicalExpression' && a.right === child) {
      if (a.operator === '&&') facts.push(...truthyFacts(cx, a.left));
      else if (a.operator === '||') facts.push(...falsyFacts(cx, a.left));
      else facts.push(...nullishFacts(cx, a.left));
    }
    child = a;
  }
  return facts;
}

type Outcome = 'ran' | SkipReason | undefined;

/**
 * The nodes whose `when` does not parse (EXPR_SYNTAX is reported there).
 * Such a node fails at its condition every time; it is never skipped by it,
 * so no way the run can go has it skipped by its `when`.
 */
function brokenWhens(cx: RuleContext): Set<string> {
  return new Set(
    cx.nodes
      .filter(
        (n) =>
          typeof n.when === 'string' &&
          cx.reported(['EXPR_SYNTAX'], ptr('nodes', cx.indexOf(n), 'when')),
      )
      .map((n) => n.id),
  );
}

/** The paths that can happen: none has a node with a broken `when`
 * skipped by it. */
function possiblePaths(
  flow: FlowFacts,
  broken: ReadonlySet<string>,
): (k: number) => boolean {
  if (broken.size === 0) return () => true;
  const ok = flow.paths.map((p) =>
    [...broken].every((id) => flow.outcomeOf(p, id) !== 'when'),
  );
  return (k) => ok.at(k) ?? false;
}

/** Every node's outcome on every path, by path position — what the path
 * queries below read thousands of times. Built once per analysis call. */
function outcomeTable(flow: FlowFacts): (id: string) => Outcome[] {
  let built: Map<string, Outcome[]> | undefined;
  return (id) => {
    if (built === undefined) {
      built = new Map(
        flow.order.map((nodeId) => [
          nodeId,
          new Array<Outcome>(flow.paths.length),
        ]),
      );
      for (const [k, p] of flow.paths.entries()) {
        for (const nodeId of p.ran) {
          const row = built.get(nodeId);
          if (row !== undefined) row[k] = 'ran';
        }
        for (const skip of p.skipped) {
          const row = built.get(skip.nodeId);
          if (row !== undefined) row[k] = skip.reason;
        }
      }
    }
    return built.get(id) ?? [];
  };
}

/** Whether node `r` evaluates its `field` on the path with outcome `o`. */
function evaluates(o: Outcome, field: string): boolean {
  if (field === 'when') return o === 'ran' || o === 'when' || o === 'error';
  return o === 'ran' || o === 'error';
}

/** Every node `id` reads data from, directly or through other nodes. */
function dataAncestors(cx: RuleContext, id: string): Set<string> {
  const out = new Set<string>();
  const pending = [id];
  while (pending.length > 0) {
    const next = pending.pop();
    const n = next === undefined ? undefined : cx.byId.get(next);
    if (n === undefined) continue;
    for (const r of cx.refs(n).data) {
      if (out.has(r) || !cx.byId.has(r)) continue;
      out.add(r);
      pending.push(r);
    }
  }
  return out;
}

/** Whether a node with `onError: continue` is among the nodes whose
 * outcome decides whether `x` runs: `x`, what it reads as data, and the
 * elseOf partners of those (and what they read). */
function failureReaches(cx: RuleContext, x: string): boolean {
  const seen = new Set<string>();
  const pending = [x];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    const n = cx.byId.get(id);
    if (n === undefined) continue;
    if (n.onError === 'continue') return true;
    pending.push(...cx.refs(n).data);
    if (typeof n.elseOf === 'string') pending.push(n.elseOf);
  }
  return false;
}

interface Skips {
  reasons: SkipReason[];
  via?: string;
  partner?: string;
  /** The node whose tolerated failure keeps the source from running. */
  failing?: string;
}

/** Why `x` may not have run where `reader` evaluates `field`; null when it
 * always ran there. */
function skipsAt(
  cx: RuleContext,
  flow: FlowFacts,
  outcomesOf: (id: string) => Outcome[],
  possible: (k: number) => boolean,
  broken: ReadonlySet<string>,
  x: string,
  reader: string | undefined,
  field: string,
  facts: readonly RanFact[],
): Skips | null {
  const xNode = cx.byId.get(x);
  // The read sits in a branch that only runs when x ran.
  if (facts.some((f) => f.nodeId === x && f.ran)) return null;
  if (flow.truncated) {
    // No paths: a reader that depends on x for data only runs when x ran;
    // otherwise any way x can be skipped counts.
    if (reader !== undefined && dataAncestors(cx, reader).has(x)) return null;
    const skips = flow
      .maySkip(x)
      .filter((s) => !(s.reason === 'when' && broken.has(x)));
    if (skips.length === 0) return null;
    const via = skips.find((s) => s.via !== undefined)?.via;
    const failing = [x, ...dataAncestors(cx, x)].find(
      (id) => cx.byId.get(id)?.onError === 'continue',
    );
    return {
      reasons: [...new Set(skips.map((s) => s.reason))],
      ...(via !== undefined && { via }),
      ...(typeof xNode?.elseOf === 'string' && { partner: xNode.elseOf }),
      ...(failing !== undefined && { failing }),
    };
  }
  const readerOutcomes = reader === undefined ? null : outcomesOf(reader);
  const xOutcomes = outcomesOf(x);
  const factOutcomes = facts.map((f) => ({
    ran: f.ran,
    outcomes: outcomesOf(f.nodeId),
  }));
  const bad = flow.paths.filter(
    (_, k) =>
      possible(k) &&
      xOutcomes[k] !== 'ran' &&
      (readerOutcomes === null || evaluates(readerOutcomes[k], field)) &&
      factOutcomes.every((f) => (f.outcomes[k] === 'ran') === f.ran),
  );
  if (bad.length === 0) return null;
  const reasons = new Set<SkipReason>();
  let via: string | undefined;
  for (const p of bad) {
    const o = flow.outcomeOf(p, x);
    if (o !== undefined && o !== 'ran') reasons.add(o);
    via ??= p.skipped.find((s) => s.nodeId === x && s.via !== undefined)?.via;
  }
  // Tracing every path back is the expensive part; only a node a tolerated
  // failure can reach needs it.
  let failing: string | undefined;
  if (failureReaches(cx, x)) {
    for (const p of bad) {
      failing = flow
        .rootCause(p, x)
        .find((c) => c.atom.startsWith('fail:'))?.nodeId;
      if (failing !== undefined) break;
    }
  }
  return {
    reasons: [...reasons],
    ...(via !== undefined && { via }),
    ...(reasons.has('else') &&
      typeof xNode?.elseOf === 'string' && { partner: xNode.elseOf }),
    ...(failing !== undefined && { failing }),
  };
}

function reasonText(s: Skips): string {
  return s.reasons
    .filter((r) => r !== 'error')
    .map((r) =>
      r === 'when'
        ? 'its own "when" is false'
        : r === 'else'
          ? `its elseOf partner "${s.partner ?? '?'}" runs`
          : `"${s.via ?? '?'}" is skipped`,
    )
    .join(' or ');
}

function nullReads(
  cx: RuleContext,
  flow: FlowFacts,
  broken: ReadonlySet<string>,
  possible: (k: number) => boolean,
  out: Issue[],
): void {
  // One answer per source node, reader, field and branch: a document reads
  // the same node in many places.
  const memo = new Map<string, Skips | null>();
  const outcomesOf = outcomeTable(flow);
  for (const { node, source } of cx.located) {
    if (!NULL_READ_FIELDS.has(source.field)) continue;
    const mixed = isMixedText(source);
    const seen = new Set<string>();
    for (const unit of source.units) {
      if (!unit.parse.ok || unit.opaque === true) continue;
      for (const site of unit.refs) {
        const x = site.nodeId;
        if (x === undefined || x === node?.id || !cx.byId.has(x)) continue;
        if (seen.has(x)) continue;
        const kind = nullRead(site, unit, mixed);
        if (kind === null) continue;
        const facts = branchFacts(cx, unit, site);
        const key = JSON.stringify([x, node?.id, source.field, facts]);
        let skips = memo.get(key);
        if (skips === undefined) {
          skips = skipsAt(
            cx,
            flow,
            outcomesOf,
            possible,
            broken,
            x,
            node?.id,
            source.field,
            facts,
          );
          memo.set(key, skips);
        }
        if (skips === null) continue;
        seen.add(x);
        out.push(
          nullReadIssue(
            cx,
            source,
            site,
            kind,
            x,
            skips,
            dynamicMember(unit, site),
          ),
        );
      }
    }
  }
}

function nullReadIssue(
  cx: RuleContext,
  source: ExprSource,
  site: RefSite,
  kind: ReadKind,
  x: string,
  skips: Skips,
  dynamic: DynamicMember | undefined,
): Issue {
  const control = source.field !== 'output';
  // A read through a computed member is named and located through it.
  const range = dynamic?.range ?? site.range;
  const ref = source.text.slice(range[0], range[1]);
  const suggestion = guarded(site, kind, control ? 'false' : 'null', dynamic);
  const related: RelatedLocation[] = [
    { role: 'source', nodeId: x, at: { pointer: cx.nodePointer(x) } },
  ];
  const at = { pointer: source.pointer, range };
  if (skips.failing !== undefined) {
    const failing = skips.failing;
    related.push({
      role: 'cause',
      nodeId: failing,
      at: { pointer: cx.nodePointer(failing) },
    });
    return warn(
      'UNCAUGHT_FAILURE',
      failing === x
        ? `${place(source)}: ${ref} reads "${x}", which continues on error — when it fails, this read fails too, so the failure is not handled`
        : `${place(source)}: ${ref} reads "${x}", which is skipped when "${failing}" fails (it continues on error) — this read then fails too, so the failure is not handled`,
      {
        nodeId: source.nodeId,
        hint: `guard the read (${suggestion}), or drop onError: continue on "${failing}" so the run stops there with its own error`,
        at,
        params: {
          ...nodeParam(source),
          field: source.field,
          ref,
          source: x,
          failing,
          reasons: [...skips.reasons],
          suggestion,
        },
        related,
      },
    );
  }
  const consequence = control
    ? `the condition then fails${kind === 'deref' ? ' with a TypeError' : ''} and the node fails`
    : 'building the output then fails, so the run fails';
  return warn(
    'MAYBE_NULL',
    `${place(source)}: ${ref} reads "${x}", which is skipped when ${reasonText(skips)} — ${consequence}`,
    {
      nodeId: source.nodeId,
      hint: `guard the read: ${suggestion} — or give "${x}" an elseOf partner that produces a fallback`,
      at,
      params: {
        ...nodeParam(source),
        field: source.field,
        ref,
        source: x,
        reasons: [...skips.reasons],
        ...(skips.via !== undefined && { via: skips.via }),
        ...(skips.partner !== undefined && { partner: skips.partner }),
        suggestion,
      },
      related,
    },
  );
}

// ---------------------------------------------------------- unreachable

type UnreachableCause =
  | { cause: 'constant-when'; value: string }
  | { cause: 'else-partner-unreachable'; partner: string }
  | { cause: 'else-partner-always-runs'; partner: string }
  | { cause: 'reads-partner'; partner: string }
  | { cause: 'upstream-unreachable'; via: string }
  | { cause: 'exclusive-branches'; a: string; b: string };

function unreachableCause(
  cx: RuleContext,
  flow: FlowFacts,
  n: NodeDef,
): UnreachableCause | null {
  const whenAtom = flow.atoms.find((a) => a.id === `when:${n.id}`);
  if (whenAtom?.fixed === true && whenAtom.value === false) {
    return { cause: 'constant-when', value: n.when ?? '' };
  }
  const data = [...cx.refs(n).data].filter((r) => cx.byId.has(r));
  const partner = n.elseOf;
  if (typeof partner === 'string' && cx.byId.has(partner)) {
    if (!flow.reach(partner).reached) {
      return { cause: 'else-partner-unreachable', partner };
    }
    // A partner without a `when` is ELSEOF_TARGET_INVALID's (an error).
    if (
      cx.reported(
        ['ELSEOF_TARGET_INVALID'],
        ptr('nodes', cx.indexOf(n), 'elseOf'),
      )
    ) {
      return null;
    }
    const partnerSkips = flow.truncated
      ? flow.maySkip(partner).some((s) => s.reason === 'when')
      : flow.paths.some((p) => flow.outcomeOf(p, partner) === 'when');
    if (!partnerSkips) return { cause: 'else-partner-always-runs', partner };
    if (data.includes(partner)) return { cause: 'reads-partner', partner };
  }
  const never = data.find((d) => !flow.reach(d).ran);
  if (never !== undefined) return { cause: 'upstream-unreachable', via: never };
  if (flow.truncated) return null;
  for (const [i, a] of data.entries()) {
    for (const b of data.slice(i + 1)) {
      const together = flow.paths.some(
        (p) => flow.outcomeOf(p, a) === 'ran' && flow.outcomeOf(p, b) === 'ran',
      );
      if (!together) return { cause: 'exclusive-branches', a, b };
    }
  }
  return null;
}

function causeText(c: UnreachableCause): string {
  switch (c.cause) {
    case 'constant-when':
      return `its "when" is always false (${c.value.trim()})`;
    case 'else-partner-unreachable':
      return `its elseOf partner "${c.partner}" never runs`;
    case 'else-partner-always-runs':
      return `its elseOf partner "${c.partner}" always runs`;
    case 'reads-partner':
      return `it reads "${c.partner}", its own elseOf partner — whenever this branch should run, that output is missing`;
    case 'upstream-unreachable':
      return `it reads "${c.via}", which can never run`;
    default:
      return `it reads both "${c.a}" and "${c.b}", which never run in the same run`;
  }
}

function unreachable(
  cx: RuleContext,
  flow: FlowFacts,
  out: Issue[],
): Set<string> {
  const ids = new Set<string>();
  for (const n of cx.nodes) {
    if (flow.reach(n.id).executed) continue;
    const c = unreachableCause(cx, flow, n);
    // A combination the causes below do not name (three branches that
    // never meet, say) is left unreported rather than misdescribed.
    if (c === null) continue;
    ids.add(n.id);
    const base = ptr('nodes', cx.indexOf(n));
    const causeNodes = [
      ...('partner' in c ? [c.partner] : []),
      ...('via' in c ? [c.via] : []),
      ...('a' in c ? [c.a, c.b] : []),
    ];
    const params = {
      node: n.id,
      cause: c.cause,
      ...('partner' in c && { partner: c.partner }),
      ...('via' in c && { via: c.via }),
      ...('a' in c && { a: c.a, b: c.b }),
      ...('value' in c && { value: c.value }),
    };
    out.push(
      warn('UNREACHABLE', `node "${n.id}" can never run: ${causeText(c)}`, {
        nodeId: n.id,
        hint:
          c.cause === 'constant-when'
            ? 'make the condition depend on data, or remove the node'
            : 'a node that reads a skipped node is skipped too — merge alternative branches in the automation "output" (with ?? fallbacks), or remove the node',
        at: { pointer: c.cause === 'constant-when' ? `${base}/when` : base },
        params,
        ...(causeNodes.length > 0 && {
          related: causeNodes.map((id) => ({
            role: 'cause' as const,
            nodeId: id,
            at: { pointer: cx.nodePointer(id) },
          })),
        }),
      }),
    );
  }
  return ids;
}

// ------------------------------------------------------ output may be empty

/** A value that stands for "nothing": null, undefined, `''`, `[]`, `{}`. */
function isEmptyValue(node: Node): boolean {
  switch (node.type) {
    case 'Literal':
      return node.value === null || node.value === '';
    case 'Identifier':
      return node.name === 'undefined';
    case 'ArrayExpression':
      return node.elements.length === 0;
    case 'ObjectExpression':
      return node.properties.length === 0;
    case 'TemplateLiteral':
      return node.expressions.length === 0 && node.quasis[0]?.value.raw === '';
    default:
      return false;
  }
}

/** Whether a read sits on the left of a `??` or `||` whose fallback is a
 * real value (`?? 'none'`), so its node being skipped empties nothing. */
function hasRealFallback(unit: ExprUnit, site: RefSite): boolean {
  if (!unit.parse.ok) return false;
  const at = ancestorsOf(unit.parse.ast, site.range);
  if (at === null) return false;
  let child = at.chain;
  for (let k = at.ancestors.length - 1; k >= 0; k--) {
    const a = at.ancestors[k];
    if (
      a.type === 'LogicalExpression' &&
      a.left === child &&
      (a.operator === '??' || a.operator === '||')
    ) {
      return !isEmptyValue(a.right);
    }
    // Only a chain handed on as it is reaches the fallback.
    const passes =
      a.type === 'ChainExpression' ||
      (a.type === 'MemberExpression' && a.object === child) ||
      (a.type === 'CallExpression' && a.callee === child);
    if (!passes) return false;
    child = a;
  }
  return false;
}

function outputMaybeEmpty(
  cx: RuleContext,
  flow: FlowFacts,
  possible: (k: number) => boolean,
  out: Issue[],
): void {
  if (flow.truncated || cx.doc.output === undefined) return;
  const read: string[] = [];
  // Whether some read hands its node's output on as it is (or with an
  // empty fallback such as `?? null`): only then can the output be empty.
  let plain = false;
  // Reads that throw when their node did not run (MAYBE_NULL's): where one
  // is evaluated without its node, the run fails rather than returning
  // empty values.
  const failing: Array<{ nodeId: string; facts: RanFact[] }> = [];
  for (const source of cx.outputSources()) {
    const mixed = isMixedText(source);
    for (const unit of source.units) {
      for (const site of unit.refs) {
        const id = site.nodeId;
        if (id === undefined || !cx.byId.has(id)) continue;
        if (!read.includes(id)) read.push(id);
        if (unit.parse.ok && unit.opaque !== true) {
          if (nullRead(site, unit, mixed) !== null) {
            failing.push({ nodeId: id, facts: branchFacts(cx, unit, site) });
            continue;
          }
        }
        plain ||= !hasRealFallback(unit, site);
      }
    }
  }
  if (read.length === 0 || !plain) return;
  const fails = (p: PathOutcome): boolean =>
    failing.some(
      (f) =>
        flow.outcomeOf(p, f.nodeId) !== 'ran' &&
        f.facts.every(
          (fact) => (flow.outcomeOf(p, fact.nodeId) === 'ran') === fact.ran,
        ),
    );
  const empty = flow.paths.find(
    (p, k) =>
      possible(k) &&
      read.every((id) => flow.outcomeOf(p, id) !== 'ran') &&
      !fails(p),
  );
  if (empty === undefined) return;
  const cause = flow.rootCause(empty, read[0]).at(0);
  if (cause === undefined) return;
  const root = cause.nodeId;
  const rootReason = cause.atom.startsWith('fail:')
    ? 'error'
    : flow.outcomeOf(empty, root) === 'when'
      ? 'when'
      : 'else';
  const ordered = flow.order.filter((id) => read.includes(id));
  const list =
    ordered.length === 1
      ? `"${ordered[0]}", which does not run`
      : `${ordered.map((id) => `"${id}"`).join(', ')}, and none of them runs`;
  const when =
    rootReason === 'when'
      ? `"${root}" is skipped by its "when"`
      : rootReason === 'error'
        ? `"${root}" fails (it continues on error)`
        : `"${root}" runs (its elseOf alternative is then skipped)`;
  out.push(
    warn(
      'OUTPUT_MAYBE_EMPTY',
      `output reads only ${list} when ${when} — the automation then returns empty values`,
      {
        hint: `read a node that always runs as well, or give "${root}" an elseOf partner that produces a fallback`,
        at: { pointer: '/output' },
        params: { nodes: ordered, root, rootReason },
        related: [
          {
            role: 'cause',
            nodeId: root,
            at: { pointer: cx.nodePointer(root) },
          },
        ],
      },
    ),
  );
}

// -------------------------------------------- read only by unreachable nodes

function readOnlyByUnreachable(
  cx: RuleContext,
  dead: ReadonlySet<string>,
  out: Issue[],
): void {
  if (dead.size === 0) return;
  const outputReads = new Set<string>();
  for (const source of cx.outputSources()) {
    for (const unit of source.units) {
      for (const site of unit.refs) {
        if (site.nodeId !== undefined) outputReads.add(site.nodeId);
      }
    }
  }
  const elseTargets = new Set(
    cx.nodes.flatMap((n) => (typeof n.elseOf === 'string' ? [n.elseOf] : [])),
  );
  const last = cx.nodes.at(-1);
  for (const n of cx.nodes) {
    if (n === last || dead.has(n.id) || outputReads.has(n.id)) continue;
    if (elseTargets.has(n.id)) continue;
    if (nodeTypes().get(n.type)?.connector?.hasEffect === true) continue;
    const readers = cx.nodes
      .filter((m) => {
        if (m.id === n.id) return false;
        const refs = cx.refs(m);
        return refs.order.has(n.id) && m.elseOf !== n.id;
      })
      .map((m) => m.id);
    if (readers.length === 0 || !readers.every((r) => dead.has(r))) continue;
    out.push(
      warn(
        'UNUSED_NODE',
        `output of node "${n.id}" is only read by nodes that can never run (${readers.join(', ')})`,
        {
          nodeId: n.id,
          hint: `make one of those nodes reachable, or remove "${n.id}"`,
          at: { pointer: ptr('nodes', cx.indexOf(n)) },
          params: { node: n.id, reason: 'readers-unreachable' },
          related: readers.map((id) => ({
            role: 'reader' as const,
            nodeId: id,
            at: { pointer: cx.nodePointer(id) },
          })),
        },
      ),
    );
  }
}

/** The flow findings; the ids of the nodes found unreachable. */
export function flowRules(
  cx: RuleContext,
  flow: FlowFacts,
  out: Issue[],
): Set<string> {
  const broken = brokenWhens(cx);
  const possible = possiblePaths(flow, broken);
  nullReads(cx, flow, broken, possible, out);
  const dead = unreachable(cx, flow, out);
  outputMaybeEmpty(cx, flow, possible, out);
  readOnlyByUnreachable(cx, dead, out);
  return dead;
}
