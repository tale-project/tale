/**
 * Findings built on the shapes of the values an automation computes
 * (`../../typing`). Every one is a warning, and every one stays silent on
 * what the typing does not know: an unknown shape, an open object that
 * declares nothing, a union some member of which fits.
 *
 *  - REF_UNKNOWN_FIELD — a member chain names a field its base does not
 *    have: a node's output, a nested key of the run input, a forEach item,
 *    a pass's `output`, or (in transform code) the node's own input
 *    mapping. A top-level `input.<key>` stays INPUT_KEY_UNKNOWN's, and a
 *    read the reference pass already refused gets nothing more.
 *  - TYPE_MISMATCH — a value certainly has the wrong kind for where it
 *    goes: a connector input property, an input of the automation a
 *    subautomation node calls, or the list a forEach iterates.
 *  - TEMPLATE_NULL_INTERPOLATION — an expression inside text whose value
 *    may be missing because of its shape (an optional field, a declared
 *    null). Inside text a missing value fails the node (or the run, in the
 *    output). A node that may be skipped is the flow rules' concern.
 */

import type { Node } from 'estree';

import { isRecord } from '../../../../utils/type-utils';
import { warn } from '../../errors';
import { nodeTypes } from '../../slots';
import { pointerTokens } from '../../syntax/pointer';
import type { ExprSource, ExprUnit } from '../../syntax/sources';
import { renderPath, type PathStep, type RefSite } from '../../syntax/walk';
import type { Issue, NodeDef } from '../../types';
import { rootShapeOf, typeOfExpression, type TypeEnv } from '../../typing/expr';
import { normalizeSchema } from '../../typing/normalize';
import {
  assignable,
  isArrayLike,
  lookup,
  nullability,
  STRING_SHAPE,
  toTs,
  walkPath,
  type Mismatch,
  type Shape,
} from '../../typing/shape';
import { closestName } from '../../validate/similar';
import { isMixedText, nodeParam, place, type RuleContext } from '../context';

/** Codes of the reference pass that already describe a bad read. */
const REFUSED_READS = [
  'REF_UNKNOWN_NODE',
  'REF_NOT_OUTPUT',
  'REF_UNSTRUCTURED_PATH',
  'REF_SELF',
];

/** The base a site's path starts from, as the messages name it. */
function rootLabel(site: RefSite): string {
  return site.root === 'nodes' ? `nodes.${site.nodeId}.output` : site.root;
}

export function typeRules(cx: RuleContext, out: Issue[]): void {
  unknownFields(cx, out);
  inputMismatches(cx, out);
}

// ---------------------------------------------------------- unknown fields

function unknownFields(cx: RuleContext, out: Issue[]): void {
  for (const { node, source } of cx.located) {
    const env = cx.env(node, source.field);
    const seen = new Set<string>();
    for (const unit of source.units) {
      if (!unit.parse.ok || unit.opaque === true) continue;
      for (const site of unit.refs) {
        const issue = unknownField(cx, node, source, env, site);
        if (issue === null) continue;
        const key = JSON.stringify(issue.at?.range);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(issue);
      }
    }
  }
}

function unknownField(
  cx: RuleContext,
  node: NodeDef | undefined,
  source: ExprSource,
  env: TypeEnv,
  site: RefSite,
): Issue | null {
  const inCode = source.field === 'code';
  if (site.root === 'free' || site.root === 'index') return null;
  if (site.root === 'nodes') {
    if (site.nodeId === undefined || site.member !== 'output') return null;
    if (cx.reported(REFUSED_READS, source.pointer, site.range)) return null;
  }
  const root = rootShapeOf(site, env);
  if (root === undefined || site.path.length === 0) return null;
  const walked = walkPath(root, site.path);
  if (walked.kind !== 'missing') return null;
  // A top-level run-input key is INPUT_KEY_UNKNOWN's.
  if (site.root === 'input' && !inCode && walked.at === 0) return null;

  const step = site.path[walked.at];
  const key = String(step.key);
  const before = site.path.slice(0, walked.at);
  const base = `${rootLabel(site)}${renderPath(before)}`;
  const end = step.end ?? site.range[1];
  const ref = source.text.slice(site.range[0], end);
  const listWrapped = isArrayLike(walked.base) === 'yes';
  const suggestion = closestName(key, walked.known);

  let what: string;
  if (site.root === 'input' && inCode && walked.at === 0) {
    what = `this node's input mapping has no key "${key}"`;
  } else if (site.root === 'input' && !inCode) {
    what = `the inputs schema declares no "${key}" under ${base}`;
  } else if (site.root === 'item' && walked.at === 0) {
    what = `the forEach items have no field "${key}"`;
  } else {
    what = `${base} has no field "${key}"`;
  }

  const from = site.root === 'nodes' ? site.nodeId : undefined;
  const sourceIterates =
    from !== undefined &&
    typeof cx.byId.get(from)?.forEach === 'string' &&
    walked.at === 0;
  let hint: string;
  if (listWrapped && sourceIterates) {
    hint = `"${from}" runs once per item (forEach), so nodes.${from}.output is a list — index it (nodes.${from}.output[0].${key}) or map over it`;
  } else if (listWrapped) {
    hint = `${base} is a list — index it (${base}[0].${key}) or map over it`;
  } else if (site.root === 'input' && inCode && walked.at === 0) {
    hint = `add "${key}" to this node's "input" to pass it in`;
  } else if (walked.known.length > 0) {
    hint = `${suggestion === undefined ? '' : `did you mean "${suggestion}"? `}its fields: ${walked.known.join(', ')}`;
  } else {
    hint = `${base} is ${toTs(walked.base)}`;
  }

  return warn('REF_UNKNOWN_FIELD', `${place(source)}: ${ref} — ${what}`, {
    nodeId: source.nodeId ?? node?.id,
    hint,
    at: { pointer: source.pointer, range: [site.range[0], end] },
    params: {
      ...nodeParam(source),
      field: source.field,
      ref,
      root: site.root,
      ...(from !== undefined && { source: from }),
      key,
      known: walked.known,
      ...(suggestion !== undefined && { suggestion }),
      closed: walked.closed,
      listWrapped,
    },
  });
}

// ------------------------------------------------------------ type mismatch

/** The shape a template string evaluates to: one whole template keeps its
 * expression's shape, text around templates makes a string. Undefined when
 * the expression cannot be typed. */
function valueShape(source: ExprSource, env: TypeEnv): Shape | undefined {
  if (isMixedText(source)) return STRING_SHAPE;
  const unit = source.units[0];
  if (unit === undefined || !unit.parse.ok || unit.opaque === true) {
    return undefined;
  }
  return typeOfExpression(unit.parse.ast, env);
}

function exprLabel(source: ExprSource): string {
  if (isMixedText(source)) return JSON.stringify(source.text);
  const unit = source.units[0];
  return `{{ ${unit?.source ?? ''} }}`;
}

/** `.a[].b` — where inside a value a mismatch is (`[]` for any item). */
function mismatchTail(m: Mismatch): string {
  return m.path
    .map((k) => (k === '*' ? '[]' : renderPath([{ key: k }])))
    .join('');
}

/** The keys below `/nodes/<i>/input` that lead to a source's string. */
function inputKeys(source: ExprSource, base: string): Array<string | number> {
  return pointerTokens(source.pointer.slice(base.length)).map((k) =>
    /^(?:0|[1-9]\d*)$/.test(k) ? Number(k) : k,
  );
}

function inputMismatches(cx: RuleContext, out: Issue[]): void {
  for (const n of cx.nodes) {
    const connector = nodeTypes().get(n.type)?.connector;
    let target: Shape | undefined;
    let automation: string | undefined;
    if (connector !== undefined) {
      target = normalizeSchema(connector.inputSchema);
    } else if (n.type === 'subautomation' && typeof n.automation === 'string') {
      const child = cx.children?.get(n.automation);
      if (child !== undefined && child !== null && isRecord(child.automation)) {
        target = normalizeSchema(child.automation.inputs);
        automation = child.name;
      }
    }
    if (target === undefined) continue;
    const index = cx.indexOf(n);
    const base = `/nodes/${index}/input`;
    for (const source of cx.sources(index)) {
      if (source.field !== 'input') continue;
      const keys = inputKeys(source, base);
      if (keys.length === 0) continue;
      const wanted = walkPath(
        target,
        keys.map((key) => ({ key })),
      );
      if (wanted.kind !== 'found') continue;
      const actual = valueShape(source, cx.env(n, 'input'));
      if (actual === undefined) continue;
      const mismatch = assignable(actual, wanted.shape);
      if (mismatch === null) continue;
      const property = renderPath(keys.map((key) => ({ key }))).replace(
        /^\./,
        '',
      );
      const where = `input${renderPath(keys.map((key) => ({ key })))}${mismatchTail(mismatch)}`;
      const expr = exprLabel(source);
      out.push(
        warn(
          'TYPE_MISMATCH',
          automation === undefined
            ? `node "${n.id}" ${where}: expects ${mismatch.expected}, but ${expr} is ${mismatch.actual}`
            : `node "${n.id}" ${where} (for "${automation}"): expects ${mismatch.expected}, but ${expr} is ${mismatch.actual}`,
          {
            nodeId: n.id,
            hint:
              automation === undefined
                ? `the ${n.type} input schema wants ${mismatch.expected} here`
                : `"${automation}" declares ${mismatch.expected} for this input`,
            at: {
              pointer: source.pointer,
              ...(!isMixedText(source) &&
                source.units[0] !== undefined && {
                  range: source.units[0].range,
                }),
            },
            params: {
              node: n.id,
              consumer:
                automation === undefined
                  ? 'connector-input'
                  : 'subautomation-input',
              property,
              expr,
              expected: mismatch.expected,
              actual: mismatch.actual,
              ...(automation !== undefined && { automation }),
            },
          },
        ),
      );
    }
  }
}

/**
 * A forEach whose expression is certainly not a list. A constant one is
 * FOREACH_NOT_ARRAY's (an error); this is the typed case.
 */
export function forEachMismatch(
  cx: RuleContext,
  n: NodeDef,
  source: ExprSource,
  unit: ExprUnit,
  ast: Node,
): Issue | null {
  const actual = typeOfExpression(ast, cx.env(n, 'forEach'));
  if (isArrayLike(actual) !== 'no') return null;
  const lists = Object.entries(actual.properties ?? {})
    .filter(([, s]) => isArrayLike(s) === 'yes')
    .map(([k]) => k);
  const suggestion = lists.length === 1 ? lists[0] : undefined;
  const expr = unit.source;
  const actualTs = toTs(actual);
  return warn(
    'TYPE_MISMATCH',
    `node "${n.id}" forEach: expects an array, but {{ ${expr} }} is ${actualTs}`,
    {
      nodeId: n.id,
      hint: `point forEach at a list${suggestion === undefined ? '' : `, e.g. {{ ${expr}${renderPath([{ key: suggestion }])} }}`}`,
      at: { pointer: source.pointer, range: unit.range },
      params: {
        node: n.id,
        consumer: 'forEach',
        expr,
        expected: 'array',
        actual: actualTs,
        ...(suggestion !== undefined && { suggestion }),
      },
    },
  );
}

// ------------------------------------------------- null inside mixed text

/**
 * Why a chain's value may be missing: the first optional member it reads
 * (`optional`), or a declared null (`nullable`).
 */
function nullCause(
  site: RefSite | undefined,
  env: TypeEnv,
): { why: 'optional' | 'nullable'; key?: string } {
  if (site === undefined) return { why: 'nullable' };
  let shape = rootShapeOf(site, env);
  for (const step of site.path) {
    if (shape === undefined) break;
    const r = lookup(shape, step.key);
    if (r.kind !== 'found') break;
    if (r.optional) return { why: 'optional', key: String(step.key) };
    shape = r.shape;
  }
  const last: PathStep | undefined = site.path.at(-1);
  return last === undefined
    ? { why: 'nullable' }
    : { why: 'nullable', key: String(last.key) };
}

/** Flow findings that already explain a missing value inside `range`. */
const FLOW_NULL_CODES: ReadonlySet<string> = new Set([
  'MAYBE_NULL',
  'UNCAUGHT_FAILURE',
]);

export function nullInterpolations(
  cx: RuleContext,
  flowIssues: readonly Issue[],
  out: Issue[],
): void {
  for (const { node, source } of cx.located) {
    if (source.kind !== 'template' || source.field === 'forEach') continue;
    if (!isMixedText(source)) continue;
    const env = cx.env(node, source.field);
    for (const unit of source.units) {
      if (!unit.parse.ok || unit.opaque === true) continue;
      const shape = typeOfExpression(unit.parse.ast, env);
      if (nullability(shape) === 'never') continue;
      const covered = flowIssues.some(
        (i) =>
          FLOW_NULL_CODES.has(i.code) &&
          i.at?.pointer === source.pointer &&
          i.at.range !== undefined &&
          i.at.range[0] >= unit.range[0] &&
          i.at.range[1] <= unit.range[1],
      );
      if (covered) continue;
      const whole = unit.refs.find(
        (s) => s.range[0] === unit.range[0] && s.range[1] === unit.range[1],
      );
      const { why, key } = nullCause(whole, env);
      const expr = unit.source;
      const fails = source.nodeId === undefined ? 'run' : 'node';
      out.push(
        warn(
          'TEMPLATE_NULL_INTERPOLATION',
          why === 'optional'
            ? `${place(source)}: {{ ${expr} }} may be missing ("${key}" is optional) — inside text, a missing value fails the ${fails}`
            : `${place(source)}: {{ ${expr} }} can be null — inside text, a null value fails the ${fails}`,
          {
            nodeId: source.nodeId,
            hint: `give it a fallback: {{ ${expr} ?? '' }}`,
            at: { pointer: source.pointer, range: unit.range },
            params: {
              ...nodeParam(source),
              field: source.field,
              expr,
              why,
              ...(key !== undefined && { key }),
            },
          },
        ),
      );
    }
  }
}
