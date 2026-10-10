/**
 * Probes: how a condition explains itself. The evaluation is instrumented,
 * not the scope — each sub-expression worth a value is wrapped in a call that
 * records a summary of what it evaluated to and hands the value on untouched,
 * so `250 > 1000` can say which side was 250.
 *
 * Wrapping `e` as `__taleProbe$(k,(e))` is the identity on value and on
 * evaluation order wherever {@link probePlan} places it: an operand that
 * short-circuiting skips is never evaluated, so it simply has no probe. The
 * positions where a wrap would change meaning are never probed:
 *
 *  - a callee or a template tag — `__taleProbe$(k,(a.b))()` would call `b`
 *    without `a` as its receiver (what it is called on is probed instead);
 *  - anything inside an optional chain but the chain whole, and the part
 *    before its first `?.` — `__taleProbe$(k,(a?.b)).c` would turn the
 *    chain's short-circuit into a TypeError;
 *  - the operand of `typeof <name>` — `typeof x` of an undeclared `x` reads
 *    `"undefined"`, a probe of `x` would throw;
 *  - assignment, update and `delete` targets, object keys, the callee of
 *    `new` (a call spliced into it would change what is constructed) and the
 *    bodies of nested functions, which run once per call;
 *  - a source that names the probe or the preview function: the author could
 *    see the probe, so it is evaluated plainly.
 *
 * {@link probedExprSource} is the one wrapper both runners evaluate the
 * instrumented expression in. It is a pure string: the runner ships it like
 * any other expression, and what comes back is data.
 */

import {
  SUMMARY_ITEMS,
  SUMMARY_KEY_NAMES,
  SUMMARY_TEXT_LENGTH,
  type ValueSummary,
} from '@tale/ui/data/value-summary';
import type {
  ChainExpression,
  MemberExpression,
  Node,
  SimpleCallExpression,
} from 'estree';
import { walk } from 'zimmerframe';

import { isRecord } from '../../../utils/type-utils';
import { secretMemberName } from '../secret-patterns';
import type { ParseResult } from './parse';
import { SCOPE_ROOTS } from './walk';

/** The function a probe calls; a source that names it is not probed. */
export const PROBE_FN = '__taleProbe$';
/** The summary function inside the wrapper; reserved the same way. */
export const PREVIEW_FN = '__talePreview$';
/** The call the wrapper makes the expression through; reserved the same
 * way. */
export const CALL_FN = '__taleCall$';
/** Every name the wrapper adds; a source that names one is not probed. */
const RESERVED = [PROBE_FN, PREVIEW_FN, CALL_FN] as const;
/** Sub-expressions probed per unit. */
export const PROBES_PER_UNIT = 32;

/** Candidates a plan considers before it chooses; an expression with more
 * is capped all the same. */
const CANDIDATES_PER_UNIT = 512;

/** Work the wrapper may spend summarizing values in one evaluation (one
 * unit per value visited, per character measured, per member listed); past
 * it a summary reads as left out rather than cost the evaluation its
 * deadline. */
const SUMMARY_WORK = 1_000_000;

export interface ProbeSpec {
  /** [start, end) of the sub-expression in the field string. */
  range: [number, number];
  /**
   * The value comes from a member whose name marks a secret: `read` when the
   * sub-expression is that read (`input.apiKey`), `derived` when a part of
   * it is (`input.apiKey.trim()`), so its value may carry the secret on.
   */
  secret?: 'read' | 'derived';
}

/** The static key a member reads (`a.b`, `a['b']`, `a[0]`), if it has one. */
function staticKey(member: MemberExpression): string | undefined {
  const { property } = member;
  if (!member.computed) {
    return property.type === 'Identifier' ? property.name : undefined;
  }
  if (
    property.type === 'Literal' &&
    (typeof property.value === 'string' || typeof property.value === 'number')
  ) {
    return String(property.value);
  }
  if (
    property.type === 'TemplateLiteral' &&
    property.expressions.length === 0
  ) {
    return property.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** Whether `member` reads a member whose name marks a secret. A node id
 * (`nodes.token`) names a step, not a value, so it never does. */
function readsSecretMember(member: MemberExpression): boolean {
  if (member.object.type === 'Identifier' && member.object.name === 'nodes') {
    return false;
  }
  const key = staticKey(member);
  return key !== undefined && secretMemberName(key) !== undefined;
}

/** Whether any part of `node` — nested functions included, since what they
 * return can carry a secret on — reads a secret member or destructures one. */
function mentionsSecret(node: Node): boolean {
  let found = false;
  walk<Node, null>(node, null, {
    _(child, { next, stop }) {
      if (
        (child.type === 'MemberExpression' && readsSecretMember(child)) ||
        (child.type === 'ObjectPattern' &&
          child.properties.some(
            (property) =>
              property.type === 'Property' &&
              !property.computed &&
              property.key.type === 'Identifier' &&
              secretMemberName(property.key.name) !== undefined,
          ))
      ) {
        found = true;
        stop();
        return;
      }
      next();
    },
  });
  return found;
}

function secretOf(node: Node): ProbeSpec['secret'] {
  const inner = node.type === 'ChainExpression' ? node.expression : node;
  if (inner.type === 'MemberExpression' && readsSecretMember(inner)) {
    return 'read';
  }
  return mentionsSecret(node) ? 'derived' : undefined;
}

/** Whether a member/call spine holds a `?.` of its own (a parenthesized
 * chain inside it is closed and does not count). */
function hasOptional(node: Node): boolean {
  let current: Node = node;
  for (;;) {
    if (current.type === 'MemberExpression') {
      if (current.optional) return true;
      current = current.object;
    } else if (current.type === 'CallExpression') {
      if (current.optional) return true;
      current = current.callee;
    } else {
      return false;
    }
  }
}

/** The innermost object of a member chain. */
function chainRoot(member: MemberExpression): Node {
  let current: Node = member;
  while (current.type === 'MemberExpression') current = current.object;
  return current;
}

/** Whether a member chain from `root` is worth a value: one rooted at a scope
 * name, or at a computed value (a call's result, a list); never a constant or
 * a global (`'abc'.length`, `Math.PI`). */
function worthReading(root: Node): boolean {
  switch (root.type) {
    case 'Identifier':
      return SCOPE_ROOTS.has(root.name);
    case 'Literal':
    case 'TemplateLiteral':
    case 'ThisExpression':
    case 'Super':
    case 'MetaProperty':
      return false;
    default:
      return true;
  }
}

/** The `nodes.<id>.output` member of a chain that reads deeper into it. */
function outputPrefix(top: MemberExpression, root: Node): Node | undefined {
  if (root.type !== 'Identifier' || root.name !== 'nodes') return undefined;
  const spine: MemberExpression[] = [];
  let current: Node = top;
  while (current.type === 'MemberExpression') {
    spine.unshift(current);
    current = current.object;
  }
  const [step, output] = spine;
  if (
    step === undefined ||
    output === undefined ||
    output === top ||
    staticKey(step) === undefined ||
    staticKey(output) !== 'output'
  ) {
    return undefined;
  }
  return output;
}

/** A candidate probe, and whether it decides the unit's value: the unit
 * itself, an operand of a `&&`/`||`/`??` chain, a conditional's parts. */
interface Candidate {
  spec: ProbeSpec;
  decisive: boolean;
}

class Planner {
  readonly candidates: Candidate[] = [];
  private readonly seen = new Set<string>();

  get full(): boolean {
    return this.candidates.length >= CANDIDATES_PER_UNIT;
  }

  private emit(node: Node, decisive: boolean): void {
    if (this.full || node.range === undefined) return;
    const [start, end] = node.range;
    const key = `${start}:${end}`;
    if (start >= end || this.seen.has(key)) return;
    this.seen.add(key);
    const secret = secretOf(node);
    this.candidates.push({
      spec: { range: [start, end], ...(secret !== undefined && { secret }) },
      decisive,
    });
  }

  /** `node` in a position that is evaluated as a value; `self` is false
   * where the node itself must not be wrapped (a callee); `decisive` when
   * its value decides the unit's. */
  visit(node: Node, self: boolean, decisive = false): void {
    if (this.full) return;
    switch (node.type) {
      case 'Identifier':
        if (self && SCOPE_ROOTS.has(node.name)) this.emit(node, decisive);
        return;
      case 'MemberExpression':
        this.member(node, self, decisive);
        return;
      case 'ChainExpression':
        if (self) this.emit(node, decisive);
        this.chain(node);
        return;
      case 'CallExpression':
        if (self) this.emit(node, decisive);
        this.callee(node.callee);
        this.values(node.arguments);
        return;
      case 'NewExpression':
        if (self) this.emit(node, decisive);
        this.values(node.arguments);
        return;
      case 'TaggedTemplateExpression':
        this.callee(node.tag);
        this.values(node.quasi.expressions);
        return;
      case 'UnaryExpression':
        if (node.operator === 'delete') return;
        if (node.operator === 'typeof' && node.argument.type === 'Identifier') {
          return;
        }
        // A signed or negated literal is a constant: nothing to learn.
        if (node.argument.type === 'Literal') return;
        if (self) this.emit(node, decisive);
        this.visit(node.argument, true, decisive && node.operator === '!');
        return;
      case 'BinaryExpression':
        if (self) this.emit(node, decisive);
        if (node.left.type !== 'PrivateIdentifier') this.visit(node.left, true);
        this.visit(node.right, true);
        return;
      case 'LogicalExpression':
        if (self) this.emit(node, decisive);
        // `a && b && c` nests as `(a && b) && c`: its operands decide, the
        // part chains in between do not.
        this.visit(
          node.left,
          true,
          !(
            node.left.type === 'LogicalExpression' &&
            node.left.operator === node.operator
          ),
        );
        this.visit(node.right, true, true);
        return;
      case 'ConditionalExpression':
        if (self) this.emit(node, decisive);
        this.visit(node.test, true, true);
        this.visit(node.consequent, true, true);
        this.visit(node.alternate, true, true);
        return;
      case 'AssignmentExpression':
        this.visit(node.right, true);
        return;
      case 'SequenceExpression':
      case 'TemplateLiteral':
        this.values(node.expressions);
        return;
      case 'ArrayExpression':
        for (const element of node.elements) {
          if (element !== null) this.value(element);
        }
        return;
      case 'ObjectExpression':
        for (const property of node.properties) {
          if (property.type === 'SpreadElement') {
            this.visit(property.argument, true);
          } else if (
            // A shorthand `{ input }` has no value of its own to wrap, and a
            // method or accessor is a function body.
            !property.shorthand &&
            !property.method &&
            property.kind === 'init'
          ) {
            this.visit(property.value, true);
          }
        }
        return;
      default:
        // Literals, `this`, functions and classes, update expressions,
        // `import()`, meta properties: no value worth a probe, or none that
        // may be wrapped.
        return;
    }
  }

  private value(node: Node): void {
    this.visit(node.type === 'SpreadElement' ? node.argument : node, true);
  }

  private values(nodes: readonly Node[]): void {
    for (const node of nodes) this.value(node);
  }

  /** A member chain read as a whole: probed whole, plus the step's output
   * it reads into; computed keys and a computed root are values of their
   * own. */
  private member(
    top: MemberExpression,
    self: boolean,
    decisive: boolean,
  ): void {
    const root = chainRoot(top);
    if (self && worthReading(root)) this.emit(top, decisive);
    const prefix = outputPrefix(top, root);
    this.spine(top, prefix);
  }

  private spine(member: MemberExpression, prefix: Node | undefined): void {
    const { object } = member;
    if (object.type === 'MemberExpression') {
      if (object === prefix) this.emit(object, false);
      this.spine(object, prefix);
    } else if (object.type !== 'Identifier' && object.type !== 'Super') {
      this.visit(object, true);
    }
    if (member.computed && member.property.type !== 'PrivateIdentifier') {
      this.visit(member.property, true);
    }
  }

  /** A callee is never wrapped; what it is called on is a value. */
  private callee(callee: Node): void {
    if (callee.type === 'MemberExpression') {
      if (callee.object.type !== 'Super') this.visit(callee.object, true);
      if (callee.computed && callee.property.type !== 'PrivateIdentifier') {
        this.visit(callee.property, true);
      }
      return;
    }
    if (callee.type === 'ChainExpression' || callee.type === 'Super') return;
    this.visit(callee, false);
  }

  /** Inside an optional chain (probed whole already): the arguments and
   * computed keys are values, and the part before its first `?.` is the
   * one spine node that may be wrapped. */
  private chain(node: ChainExpression): void {
    let current: Node = node.expression;
    let isCallee = false;
    for (;;) {
      if (this.full) return;
      if (!hasOptional(current)) {
        this.visit(current, !isCallee);
        return;
      }
      if (current.type === 'MemberExpression') {
        if (current.computed && current.property.type !== 'PrivateIdentifier') {
          this.visit(current.property, true);
        }
        current = current.object;
        isCallee = false;
        continue;
      }
      if (current.type === 'CallExpression') {
        const call: SimpleCallExpression = current;
        this.values(call.arguments);
        if (call.callee.type === 'MemberExpression') {
          const method = call.callee;
          if (method.computed && method.property.type !== 'PrivateIdentifier') {
            this.visit(method.property, true);
          }
          if (method.object.type === 'Super') return;
          current = method.object;
          isCallee = false;
        } else if (call.callee.type === 'Super') {
          return;
        } else {
          current = call.callee;
          isCallee = true;
        }
        continue;
      }
      return;
    }
  }
}

/** Whether `ast` names a name the wrapper adds anywhere. */
function namesProbe(ast: Node): boolean {
  let found = false;
  walk<Node, null>(ast, null, {
    _(child, { next, stop }) {
      if (
        child.type === 'Identifier' &&
        (RESERVED as readonly string[]).includes(child.name)
      ) {
        found = true;
        stop();
        return;
      }
      next();
    },
  });
  return found;
}

/**
 * The sub-expressions of one parsed unit worth a value, outermost first
 * (pre-order); none when the source names a name the wrapper adds. Ranges
 * are the parser's, so absolute in the field string. Past
 * {@link PROBES_PER_UNIT} the plan is `capped`: it keeps the ones that
 * decide the value — the unit itself, the operands of its `&&`/`||`/`??`
 * chains, a conditional's parts — ahead of the rest, so a condition's
 * deciding operand is never the one left out.
 */
export function planProbes(unit: ParseResult & { ok: true }): {
  specs: ProbeSpec[];
  capped: boolean;
} {
  if (namesProbe(unit.ast)) return { specs: [], capped: false };
  const planner = new Planner();
  planner.visit(unit.ast, true, true);
  const all = planner.candidates;
  if (all.length <= PROBES_PER_UNIT && !planner.full) {
    return { specs: all.map((c) => c.spec), capped: false };
  }
  const kept = new Set<Candidate>();
  for (const pass of [true, false]) {
    for (const candidate of all) {
      if (kept.size >= PROBES_PER_UNIT) break;
      if (candidate.decisive === pass) kept.add(candidate);
    }
  }
  return {
    specs: all.filter((c) => kept.has(c)).map((c) => c.spec),
    capped: true,
  };
}

/** {@link planProbes}' specs alone. */
export function probePlan(unit: ParseResult & { ok: true }): ProbeSpec[] {
  return planProbes(unit).specs;
}

/** Whether `field[from, to)` holds a name the wrapper adds anywhere — in
 * code, a string or a comment alike. */
function namesProbeIn(field: string, from: number, to: number): boolean {
  for (const name of RESERVED) {
    const at = field.indexOf(name, from);
    if (at !== -1 && at + name.length <= to) return true;
  }
  return false;
}

/** Characters an identifier continues with: a probe spliced right after one
 * would merge into it (`typeof-a` → `typeof __taleProbe$(…)`). */
const IDENTIFIER_PART_RE = /[\p{ID_Continue}$‌‍]$/u;

/**
 * The unit `field[unitRange)` with `__taleProbe$(k,(` … `))` spliced around
 * each spec, `k` its index in `specs`. Null when the unit names the probe or
 * the preview function, or when the specs are not a set of nested ranges
 * inside the unit — the caller then evaluates the unit plainly.
 */
export function instrument(
  field: string,
  unitRange: readonly [number, number],
  specs: readonly ProbeSpec[],
): string | null {
  const [from, to] = unitRange;
  if (namesProbeIn(field, from, to)) return null;
  if (specs.length > PROBES_PER_UNIT) return null;
  const order = specs.map((spec, k) => ({
    k,
    start: spec.range[0],
    end: spec.range[1],
  }));
  if (order.some((o) => o.start < from || o.end > to || o.start >= o.end)) {
    return null;
  }
  order.sort((a, b) => a.start - b.start || b.end - a.end || a.k - b.k);
  let out = '';
  let at = from;
  const open: typeof order = [];
  const closeUntil = (position: number): void => {
    for (let top = open.at(-1); top !== undefined && top.end <= position;) {
      open.pop();
      out += `${field.slice(at, top.end)}))`;
      at = top.end;
      top = open.at(-1);
    }
  };
  for (const spec of order) {
    closeUntil(spec.start);
    const parent = open.at(-1);
    if (parent !== undefined && spec.end > parent.end) return null;
    out += field.slice(at, spec.start);
    at = spec.start;
    out += `${IDENTIFIER_PART_RE.test(out.slice(-2)) ? ' ' : ''}${PROBE_FN}(${spec.k},(`;
    open.push(spec);
  }
  closeUntil(Number.POSITIVE_INFINITY);
  return out + field.slice(at, to);
}

/**
 * The wrapper around an instrumented expression, the same JavaScript in both
 * runners. It captures every intrinsic it uses before any authored code runs
 * (an expression that reassigns `Array.isArray` or `JSON.stringify` cannot
 * corrupt a summary or the answer), and summarizes each probed value as
 * `summaryOf` (`@tale/ui/data/value-summary`) does — the same kind, text,
 * length, names, items and size — without running authored code: it reads
 * members by their descriptors, so a getter, an accessor `toJSON` or a
 * custom `toJSON` is never called (the size is left out instead), and a
 * cycle leaves the size out too. Proxy traps are the one way left for a
 * value to see that it was read; a proxy is not data, and the runners never
 * hand one in.
 *
 * Summarizing is bounded: each object is summarized once per evaluation,
 * and past {@link SUMMARY_WORK} a summary reads `{ kind: "elided" }`. It
 * keeps at most {@link PROBES_PER_UNIT} probes, and never throws for an
 * error the expression throws (it answers the error with the probes taken
 * until then).
 *
 * The expression runs in its own sloppy function, called through a strict
 * one with the same `this` and arguments as the plain wrapper's call: what
 * called it reads `null`, as there, and nothing of the wrapper is within its
 * reach. Only the stack is a frame or two deeper.
 *
 * Answer: `{"p": [[k, summary], …], "r": "<the plain {v} envelope>"}`, or
 * `{"p": […], "e": "<String(error)>", "n": "<error.name>"}`.
 */
const HARNESS = `(function (__taleRun$) {
'use strict';
var isArray = Array.isArray, keysOf = Object.keys, describe = Object.getOwnPropertyDescriptor;
var protoOf = Object.getPrototypeOf, create = Object.create;
var toText = String, json = JSON.stringify, finite = Number.isFinite;
var uncurry = Function.prototype.bind.bind(Function.prototype.call);
var applyOf = uncurry(Function.prototype.apply), hasOwn = uncurry(Object.prototype.hasOwnProperty);
var charCode = uncurry(String.prototype.charCodeAt), sliceText = uncurry(String.prototype.slice);
var dateToJson = Date.prototype.toJSON, timeOf = uncurry(Date.prototype.getTime), isoOf = uncurry(Date.prototype.toISOString);
var cacheGet = uncurry(WeakMap.prototype.get), cacheSet = uncurry(WeakMap.prototype.set), cache = new WeakMap();
var STOP = {}, HOLE = {}, work = 0, probes = '', count = 0;
function spend(n) {
  work += n;
  if (work > ${SUMMARY_WORK}) throw STOP;
}
function cut(text) {
  var head = sliceText(text, 0, ${SUMMARY_TEXT_LENGTH});
  var last = charCode(head, head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliceText(head, 0, -1) : head;
}
function utf8(text) {
  spend(text.length);
  var n = 0;
  for (var i = 0; i < text.length; i++) {
    var c = charCode(text, i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && charCode(text, i + 1) >= 0xdc00 && charCode(text, i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}
function kindOf(v) {
  if (v === null) return 'null';
  if (isArray(v)) return 'array';
  var t = typeof v;
  if (t === 'string' || t === 'boolean' || t === 'object') return t;
  return t === 'number' || t === 'bigint' ? 'number' : 'undefined';
}
function own(v, key) {
  var entry = describe(v, key);
  if (entry === undefined) return HOLE;
  if (!hasOwn(entry, 'value')) throw STOP;
  return entry.value;
}
function member(v, key) {
  for (var o = v, hops = 0; o !== null && o !== undefined && hops < 64; o = protoOf(o), hops++) {
    var entry = describe(o, key);
    if (entry !== undefined) {
      if (!hasOwn(entry, 'value')) throw STOP;
      return entry.value;
    }
  }
  return undefined;
}
function size(v, seen, depth) {
  spend(1);
  if (v === null) return 4;
  var t = typeof v;
  if (t === 'string') return utf8(json(v));
  if (t === 'number') return finite(v) ? json(v).length : 4;
  if (t === 'boolean') return v ? 4 : 5;
  if (t === 'bigint') return json(toText(v)).length;
  if (t !== 'object') return -1;
  var toJson = member(v, 'toJSON');
  if (typeof toJson === 'function') {
    if (toJson !== dateToJson) throw STOP;
    var time;
    try { time = timeOf(v); } catch (notADate) { throw STOP; }
    return finite(time) ? json(isoOf(v)).length : 4;
  }
  for (var s = 0; s < depth; s++) if (seen[s] === v) throw STOP;
  seen[depth] = v;
  var n = 2, i, m, item;
  if (isArray(v)) {
    var length = own(v, 'length');
    for (i = 0; i < length; i++) {
      spend(1);
      if (i > 0) n += 1;
      item = own(v, i);
      if (item === HOLE) continue;
      m = size(item, seen, depth + 1);
      n += m < 0 ? 4 : m;
    }
    return n;
  }
  var names = keysOf(v), first = true;
  spend(names.length);
  for (i = 0; i < names.length; i++) {
    item = own(v, names[i]);
    if (item === HOLE) continue;
    m = size(item, seen, depth + 1);
    if (m < 0) continue;
    n += (first ? 0 : 1) + utf8(json(names[i])) + 1 + m;
    first = false;
  }
  return n;
}
function shallow(v, kind) {
  var out = '{"kind":"' + kind + '"';
  if (kind === 'string') {
    out += v.length > ${SUMMARY_TEXT_LENGTH}
      ? ',"text":' + json(cut(v)) + ',"length":' + v.length + ',"cut":true'
      : ',"text":' + json(v) + ',"length":' + v.length;
  } else if (kind === 'number' || kind === 'boolean') {
    out += ',"text":' + json(toText(v));
  } else if (kind === 'array') {
    var length = own(v, 'length');
    out += ',"length":' + (typeof length === 'number' ? length : 0);
  } else if (kind === 'object') {
    var names = keysOf(v);
    spend(names.length);
    out += ',"keys":' + names.length + ',"names":[';
    for (var i = 0; i < names.length && i < ${SUMMARY_KEY_NAMES}; i++) out += (i > 0 ? ',' : '') + json(cut(names[i]));
    out += ']';
  }
  return out;
}
function summary(v) {
  var object = v !== null && typeof v === 'object';
  if (object) {
    var known = cacheGet(cache, v);
    if (known !== undefined) return known;
  }
  var kind = kindOf(v);
  var out = shallow(v, kind);
  if (kind === 'array') {
    out += ',"items":[';
    for (var i = 0; i < ${SUMMARY_ITEMS}; i++) {
      var item;
      try { item = own(v, i); } catch (accessor) { item = undefined; }
      if (item === HOLE) {
        if (i >= own(v, 'length')) break;
        item = undefined;
      }
      out += (i > 0 ? ',' : '') + shallow(item, kindOf(item)) + '}';
    }
    out += ']';
  }
  if (kind !== 'undefined') {
    var bytes;
    try { bytes = size(v, create(null), 0); } catch (tooMuch) { bytes = -2; }
    if (bytes !== -2) out += ',"bytes":' + (bytes < 0 ? 4 : bytes);
  }
  out += '}';
  if (object) cacheSet(cache, v, out);
  return out;
}
function ${PREVIEW_FN}(v) {
  try { return summary(v); } catch (tooMuch) { return '{"kind":"elided"}'; }
}
function ${PROBE_FN}(k, v) {
  if (count < ${PROBES_PER_UNIT} && typeof k === 'number' && k >= 0 && k < ${PROBES_PER_UNIT} && k === (k | 0)) {
    probes += (count > 0 ? ',' : '') + '[' + k + ',' + ${PREVIEW_FN}(v) + ']';
    count++;
  }
  return v;
}
function call(f, list) {
  return applyOf(f, undefined, list);
}
try {
  var text = json({ v: __taleRun$(${PROBE_FN}, call) });
  return '{"p":[' + probes + ']' + (typeof text === 'string' ? ',"r":' + json(text) : '') + '}';
} catch (error) {
  var message, name;
  try { message = toText(error); } catch (unprintable) { message = 'the expression threw a value that cannot be printed'; }
  try { name = error !== null && typeof error === 'object' ? error.name : undefined; } catch (unreadable) { name = undefined; }
  return '{"p":[' + probes + '],"e":' + json(message) + (typeof name === 'string' ? ',"n":' + json(name) : '') + '}';
}
})`;

/**
 * The source a runner evaluates for an instrumented expression: the
 * {@link HARNESS} around a function that binds the scope `keys` exactly as
 * the plain expression wrapper does — the same parameters in the same order,
 * read off `__scope` — and makes `__taleProbe$` the only other name the
 * expression can see. `keys` are the runner's identifier-safe scope keys.
 */
export function probedExprSource(
  instrumented: string,
  keys: readonly string[],
): string {
  const args = keys.map((key) => `__scope.${key}`).join(', ');
  return `${HARNESS}(function (${PROBE_FN}, ${CALL_FN}) { return ${CALL_FN}(function(${keys.join(', ')}) { return (${instrumented}); }, [${args}]); })`;
}

/** What a probed evaluation answered, before the runner reads its value. */
export interface ProbedAnswer {
  /** The plain `{v}` envelope text, as the plain evaluation produces it;
   * null when the expression threw or its envelope was not text. */
  valueJson: string | null;
  probes: Array<[number, ValueSummary]>;
  error?: { message: string; name?: string };
}

const WIRE_KINDS: ReadonlySet<string> = new Set<ValueSummary['kind']>([
  'string',
  'number',
  'boolean',
  'null',
  'undefined',
  'array',
  'object',
  'elided',
]);

function isWireKind(kind: unknown): kind is ValueSummary['kind'] {
  return typeof kind === 'string' && WIRE_KINDS.has(kind);
}

function cutWire(text: string): string {
  if (text.length <= SUMMARY_TEXT_LENGTH) return text;
  const head = text.slice(0, SUMMARY_TEXT_LENGTH);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

/** A summary as the wrapper wrote it, held to the summary's own bounds. */
function summaryFromWire(
  raw: unknown,
  withItems: boolean,
): ValueSummary | null {
  if (!isRecord(raw) || !isWireKind(raw.kind)) return null;
  const summary: ValueSummary = { kind: raw.kind };
  if (typeof raw.text === 'string') summary.text = cutWire(raw.text);
  if (typeof raw.length === 'number') summary.length = raw.length;
  if (typeof raw.keys === 'number') summary.keys = raw.keys;
  if (Array.isArray(raw.names)) {
    summary.names = raw.names
      .slice(0, SUMMARY_KEY_NAMES)
      .filter((name): name is string => typeof name === 'string')
      .map(cutWire);
  }
  if (withItems && Array.isArray(raw.items)) {
    summary.items = raw.items
      .slice(0, SUMMARY_ITEMS)
      .map((item) => summaryFromWire(item, false))
      .filter((item): item is ValueSummary => item !== null);
  }
  if (raw.cut === true) summary.cut = true;
  if (typeof raw.bytes === 'number') summary.bytes = raw.bytes;
  return summary;
}

/**
 * Read what {@link probedExprSource} answered. Throws when the answer is not
 * the wrapper's — the runner then fails the probed evaluation, and the caller
 * evaluates plainly.
 */
export function readProbedAnswer(answer: string | null): ProbedAnswer {
  let parsed: unknown;
  try {
    parsed = answer === null ? null : JSON.parse(answer);
  } catch (cause) {
    throw new Error('the probed evaluation answered no readable result', {
      cause,
    });
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.p)) {
    throw new Error('the probed evaluation answered no readable result');
  }
  const probes: Array<[number, ValueSummary]> = [];
  for (const entry of parsed.p.slice(0, PROBES_PER_UNIT)) {
    if (!Array.isArray(entry)) continue;
    const [k, raw] = entry;
    const summary = summaryFromWire(raw, true);
    if (
      typeof k === 'number' &&
      Number.isInteger(k) &&
      k >= 0 &&
      k < PROBES_PER_UNIT &&
      summary !== null
    ) {
      probes.push([k, summary]);
    }
  }
  if (typeof parsed.e === 'string') {
    return {
      valueJson: null,
      probes,
      error: {
        message: parsed.e,
        ...(typeof parsed.n === 'string' && { name: parsed.n }),
      },
    };
  }
  return {
    valueJson: typeof parsed.r === 'string' ? parsed.r : null,
    probes,
  };
}
