/**
 * The template engine: `{{ <JavaScript expression> }}` inside any string
 * value, evaluated through the CodeRunner against a data-only scope
 * (`input`, `nodes.<id>.output`, and `item`/`index` under forEach).
 *
 * JS expressions are a measured choice: models author them far more
 * reliably than any rule DSL, and IO isolation comes from the runner, not
 * from restricting the language.
 *
 * Two rules authors rely on:
 *  - a field that is EXACTLY one template keeps the expression's type
 *    (`"{{ input.n }}"` → number);
 *  - mixed text interpolates, and interpolating null/undefined is an error —
 *    silent `"undefined: 18°C"` strings are a real, measured failure mode.
 *
 * Where a template begins and ends, and which nodes an expression reads, is
 * decided by the parser (`./syntax`), never by a pattern: a `}}` inside a
 * string or an object literal does not end a template, and a `nodes` in a
 * comment or a string is not a reference.
 */

import { codeRunner } from './runner';
import { parseBody, parseExpressionIn } from './syntax/parse';
import { isSingleTemplate, tokenizeTemplate } from './syntax/tokens';
import { collectRefs, SCOPE_ROOTS } from './syntax/walk';

export class ExprError extends Error {
  constructor(
    public expr: string,
    message: string,
  ) {
    super(message);
  }
}

/** Names through which code can reach `nodes` without spelling it. */
const INDIRECT_SCOPE_RE = /\b(?:eval|Function|arguments)\b/;

/**
 * The scope a piece of source actually needs: `nodes` cut down to the ids it
 * names statically, everything else untouched.
 *
 * A scope carries every prior node output, and each expression of a prompt
 * ships the whole of it across the runner boundary — serialized, sent,
 * parsed. Pruning is what keeps a `{{ input.task.title }}` cheap after a
 * node has produced megabytes. It never changes what the code sees: a node
 * the source does not name reads as `undefined` with or without pruning.
 * Any other use of the `nodes` identifier — a computed index, a spread, the
 * object handed to a function — could reach an unnamed node, so the source
 * keeps the full scope, as does source that does not parse or that could
 * reach the scope indirectly. Wrongly keeping too much only costs time; the
 * check errs that way.
 */
function scopeForSource(
  src: string,
  kind: 'expr' | 'body',
  scope: Record<string, unknown>,
): Record<string, unknown> {
  const nodes = scope.nodes;
  if (!isPlainRecord(nodes) || INDIRECT_SCOPE_RE.test(src)) return scope;
  const parsed =
    kind === 'body' ? parseBody(src) : parseExpressionIn(src, 0, src.length);
  if (!parsed.ok) return scope;
  const kept: Record<string, unknown> = {};
  for (const ref of collectRefs(parsed.ast, { roots: SCOPE_ROOTS })) {
    if (ref.root !== 'nodes') continue;
    if (ref.nodeId === undefined) return scope;
    if (Object.hasOwn(nodes, ref.nodeId)) kept[ref.nodeId] = nodes[ref.nodeId];
  }
  return { ...scope, nodes: kept };
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Expression evaluation budget. Expressions are lookups and small
 * reshapes — anything that needs longer belongs in a transform node — but
 * the budget is wall-clock inside a shared runner process on a busy host, so
 * it sits far above what a lookup needs: a starved child must not fail an
 * honest expression, and a runaway loop is still stopped within a second. */
const EXPR_TIMEOUT_MS = 1000;

async function evalExpr(
  expr: string,
  scope: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await codeRunner().evalExpr(
      expr,
      scopeForSource(expr, 'expr', scope),
      {
        timeoutMs: EXPR_TIMEOUT_MS,
      },
    );
  } catch (e) {
    throw new ExprError(
      expr,
      `{{ ${expr} }} → ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function interpolate(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Everything else in a template scope is JSON data (the runner is
  // data-only), so objects and arrays serialize; null and undefined were
  // rejected by the caller before interpolation.
  return JSON.stringify(v);
}

/** Evaluate templates in a value tree (see the module doc for the two
 * rules). */
export async function evalTemplates(
  value: unknown,
  scope: Record<string, unknown>,
): Promise<unknown> {
  if (typeof value === 'string') {
    if (!value.includes('{{')) return value;
    const tokens = tokenizeTemplate(value);
    const exprs = tokens.segments.filter((s) => s.kind === 'expr');
    if (exprs.length === 0) return value;
    if (isSingleTemplate(value, tokens)) {
      return await evalExpr(exprs[0].source ?? '', scope);
    }
    let out = '';
    for (const segment of tokens.segments) {
      if (segment.kind === 'text') {
        out += value.slice(segment.start, segment.end);
        continue;
      }
      const expr = segment.source ?? '';
      const v = await evalExpr(expr, scope);
      if (v === undefined || v === null) {
        throw new ExprError(
          expr,
          `template {{ ${expr} }} evaluated to ${String(v)} inside the string ${JSON.stringify(value.slice(0, 80))} — the referenced value does not exist. Check the exact output shape in the trace and your run input.`,
        );
      }
      out += interpolate(v);
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await evalTemplates(v, scope));
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await evalTemplates(v, scope);
    }
    return out;
  }
  return value;
}

/** Evaluate a condition field (`when`/`repeatUntil`): `"{{ expr }}"` or a
 * bare expression. */
export async function evalCondition(
  cond: string,
  scope: Record<string, unknown>,
): Promise<unknown> {
  if (cond.includes('{{')) return await evalTemplates(cond, scope);
  return await evalExpr(cond.trim(), scope);
}

/** Transform-code budget: room for real reshaping over large arrays while
 * still bounding a runaway loop. */
const CODE_TIMEOUT_MS = 1000;

/** Run transform code: a function body with `input`, `nodes` (and `item`,
 * `index`) in scope. */
export async function runCode(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs = CODE_TIMEOUT_MS,
): Promise<unknown> {
  try {
    return await codeRunner().runBody(
      code,
      scopeForSource(code, 'body', scope),
      {
        timeoutMs,
      },
    );
  } catch (e) {
    throw new ExprError('[code]', e instanceof Error ? e.message : String(e));
  }
}
