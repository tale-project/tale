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

import {
  exprFailureOf,
  type ExprWhere,
  type FailureCause,
  fieldOf,
} from './record/failure';
import type { EvalTrace, EvalUnitTrace } from './record/types';
import { codeRunner } from './runner';
import { parseBody, parseExpressionIn } from './syntax/parse';
import { ptr } from './syntax/pointer';
import { isSingleTemplate, tokenizeTemplate } from './syntax/tokens';
import { collectRefs, renderPath, SCOPE_ROOTS } from './syntax/walk';

/**
 * An expression, template or piece of code that failed. `failure` says why
 * and where, in the vocabulary a run record keeps (`record/failure.ts`); the
 * message is the engine's English, unchanged.
 */
export class ExprError extends Error {
  constructor(
    public expr: string,
    message: string,
    public failure?: FailureCause,
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
  where?: ExprWhere,
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
    const message = e instanceof Error ? e.message : String(e);
    throw new ExprError(
      expr,
      `{{ ${expr} }} → ${message}`,
      exprFailureOf(message, expr, where, readsOf),
    );
  }
}

/**
 * Every static member read in `expr`, as the chain read and the key read
 * from it — `nodes.fetch.output.items.length` reads `output` of
 * `nodes.fetch`, `items` of `nodes.fetch.output` and `length` of
 * `nodes.fetch.output.items` — so a read of a missing value can be traced
 * to the chain that held nothing.
 */
function readsOf(
  expr: string,
): Array<{ chain: string; key: string; source?: string }> {
  const parsed = parseExpressionIn(expr, 0, expr.length);
  if (!parsed.ok) return [];
  const reads: Array<{ chain: string; key: string; source?: string }> = [];
  for (const site of collectRefs(parsed.ast, { roots: SCOPE_ROOTS })) {
    let chain = site.name;
    let source: string | undefined;
    if (site.root === 'nodes') {
      if (site.nodeId === undefined) continue;
      source = site.nodeId;
      chain = `nodes${renderPath([{ key: site.nodeId }])}`;
      if (site.member === undefined) continue;
      reads.push({ chain, key: site.member, source });
      chain += renderPath([{ key: site.member }]);
    }
    for (const step of site.path) {
      reads.push({
        chain,
        key: String(step.key),
        ...(source !== undefined && { source }),
      });
      chain += renderPath([step]);
    }
  }
  return reads;
}

function interpolate(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Everything else in a template scope is JSON data (the runner is
  // data-only), so objects and arrays serialize; null and undefined were
  // rejected by the caller before interpolation.
  return JSON.stringify(v);
}

/** Where a unit sits: the field's pointer when the caller named one. */
function whereOf(
  pointer: string | undefined,
  range: [number, number],
): ExprWhere | undefined {
  return pointer === undefined ? undefined : { pointer, range };
}

/** The `[start, end)` of a template segment's expression in its field. */
function unitRange(segment: {
  start: number;
  end: number;
  exprStart?: number;
  exprEnd?: number;
}): [number, number] {
  return [segment.exprStart ?? segment.start, segment.exprEnd ?? segment.end];
}

/** Evaluate templates in a value tree (see the module doc for the two
 * rules). `pointer` is where `value` sits in the document, so a failure can
 * say which field failed; a caller that does not know it leaves it out. */
export async function evalTemplates(
  value: unknown,
  scope: Record<string, unknown>,
  pointer?: string,
): Promise<unknown> {
  if (typeof value === 'string') {
    if (!value.includes('{{')) return value;
    const tokens = tokenizeTemplate(value);
    const exprs = tokens.segments.filter((s) => s.kind === 'expr');
    if (exprs.length === 0) return value;
    if (isSingleTemplate(value, tokens)) {
      return await evalExpr(
        exprs[0].source ?? '',
        scope,
        whereOf(pointer, unitRange(exprs[0])),
      );
    }
    let out = '';
    for (const segment of tokens.segments) {
      if (segment.kind === 'text') {
        out += value.slice(segment.start, segment.end);
        continue;
      }
      const expr = segment.source ?? '';
      const where = whereOf(pointer, unitRange(segment));
      const v = await evalExpr(expr, scope, where);
      if (v === undefined || v === null) {
        throw new ExprError(
          expr,
          `template {{ ${expr} }} evaluated to ${String(v)} inside the string ${JSON.stringify(value.slice(0, 80))} — the referenced value does not exist. Check the exact output shape in the trace and your run input.`,
          {
            reason: 'TEMPLATE_VALUE_MISSING',
            params: {
              ...(where !== undefined && { field: fieldOf(where.pointer) }),
              expr,
              base: v === null ? 'null' : 'undefined',
            },
            ...(where !== undefined && { at: where }),
          },
        );
      }
      out += interpolate(v);
    }
    return out;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const [i, v] of value.entries()) {
      out.push(
        await evalTemplates(
          v,
          scope,
          pointer === undefined ? undefined : pointer + ptr(i),
        ),
      );
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await evalTemplates(
        v,
        scope,
        pointer === undefined ? undefined : pointer + ptr(k),
      );
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
  pointer?: string,
): Promise<unknown> {
  if (cond.includes('{{')) return await evalTemplates(cond, scope, pointer);
  return await evalExpr(cond.trim(), scope, whereOf(pointer, bareRange(cond)));
}

/** The `[start, end)` of a bare expression's text, whitespace aside. */
function bareRange(cond: string): [number, number] {
  const start = cond.length - cond.trimStart().length;
  return [start, start + cond.trim().length];
}

/** A value and how it was reached: the field's units, each with the values
 * of its sub-expressions when the evaluation could record them. */
export interface TracedValue {
  value: unknown;
  trace: EvalTrace;
}

/** The units of a condition or template field: the bare expression, or each
 * `{{ }}` unit. */
function unitsOf(
  field: string,
  kind: 'condition' | 'template',
): EvalUnitTrace[] {
  if (kind === 'condition' && !field.includes('{{')) {
    return [{ range: bareRange(field), probes: [], probed: 'none' }];
  }
  return tokenizeTemplate(field)
    .segments.filter((segment) => segment.kind === 'expr')
    .map((segment) => ({
      range: unitRange(segment),
      probes: [],
      probed: 'none',
    }));
}

/** Evaluate `field` as `evaluate` does, answering the trace of its units;
 * a failure carries the trace, its failing unit marked with the error. */
async function traced(
  field: string,
  pointer: string,
  kind: 'condition' | 'template',
  evaluate: () => Promise<unknown>,
): Promise<TracedValue> {
  const trace: EvalTrace = { pointer, units: unitsOf(field, kind) };
  try {
    return { value: await evaluate(), trace };
  } catch (error) {
    if (error instanceof ExprError && error.failure !== undefined) {
      const at = error.failure.at?.range;
      const unit = trace.units.find(
        (u) => at !== undefined && u.range[0] === at[0] && u.range[1] === at[1],
      );
      if (unit !== undefined) unit.error = { message: error.message };
      error.failure.trace = trace;
    }
    throw error;
  }
}

/** `when` / `repeatUntil`: {@link evalCondition}, with the trace of how the
 * value was reached. Throws exactly when {@link evalCondition} would. */
export async function evalConditionTraced(
  cond: string,
  scope: Record<string, unknown>,
  pointer: string,
): Promise<TracedValue> {
  return await traced(cond, pointer, 'condition', () =>
    evalCondition(cond, scope, pointer),
  );
}

/** `forEach`: {@link evalTemplates} on one string, with the trace of how the
 * value was reached. Throws exactly when {@link evalTemplates} would. */
export async function evalTemplateTraced(
  text: string,
  scope: Record<string, unknown>,
  pointer: string,
): Promise<TracedValue> {
  return await traced(text, pointer, 'template', () =>
    evalTemplates(text, scope, pointer),
  );
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
  pointer?: string,
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
    const message = e instanceof Error ? e.message : String(e);
    const timeout = CODE_TIMEOUT_RE.exec(message);
    const errorName = CODE_ERROR_NAME_RE.exec(message)?.[1];
    const failure: FailureCause =
      timeout !== null
        ? { reason: 'CODE_TIMEOUT', params: { limitMs: Number(timeout[1]) } }
        : {
            reason: 'CODE_FAILED',
            params: {
              ...(errorName !== undefined && { errorName }),
              detail: message,
            },
          };
    if (pointer !== undefined) failure.at = { pointer };
    throw new ExprError('[code]', message, failure);
  }
}

const CODE_TIMEOUT_RE = /timed out after (\d+)\s*ms/;
const CODE_ERROR_NAME_RE =
  /\b((?:Type|Reference|Range|Syntax|Eval|URI)?Error): /;
