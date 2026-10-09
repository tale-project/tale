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

import type { ValueSummary } from '@tale/ui/data/value-summary';

import {
  exprFailureOf,
  type ExprWhere,
  type FailureCause,
  fieldOf,
} from './record/failure';
import type { EvalTrace, EvalUnitTrace } from './record/types';
import {
  redactSummary,
  secretTextsIn,
  summaryShowsSecret,
} from './record/value';
import {
  codeRunner,
  hasCodeRunner,
  type ProbedResult,
  RunnerStopped,
} from './runner';
import { parseBody, parseExpressionIn } from './syntax/parse';
import { ptr } from './syntax/pointer';
import {
  CALL_FN,
  instrument,
  planProbes,
  PREVIEW_FN,
  PROBE_FN,
  type ProbeSpec,
} from './syntax/probe';
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
    /** The runner stopped the evaluation (it killed or lost the process
     * running it): nothing evaluates it again. */
    public readonly stopped = false,
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
      e instanceof RunnerStopped,
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
 * `{{ }}` unit, in the order they are evaluated. */
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

/** Evaluate `field` unit by unit, answering the trace of its units; a
 * failure carries the trace, its failing unit marked with the error. */
async function traced(
  field: string,
  pointer: string,
  kind: 'condition' | 'template',
  evaluate: (units: EvalUnitTrace[]) => Promise<unknown>,
): Promise<TracedValue> {
  const trace: EvalTrace = { pointer, units: unitsOf(field, kind) };
  try {
    return { value: await evaluate(trace.units), trace };
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

/** An expression with probes spliced in, what each probe reads, and
 * whether the plan had to leave some sub-expressions out. */
interface ProbedUnit {
  source: string;
  specs: ProbeSpec[];
  capped: boolean;
}

/** The unit `field[range)` with probes, or null when it is evaluated plainly:
 * it does not parse, it or the scope names a name the probe wrapper adds,
 * or the probes would not nest. */
function probedUnit(
  field: string,
  range: [number, number],
  scope: Record<string, unknown>,
): ProbedUnit | null {
  if (
    [PROBE_FN, PREVIEW_FN, CALL_FN].some((name) => Object.hasOwn(scope, name))
  ) {
    return null;
  }
  const parsed = parseExpressionIn(field, range[0], range[1]);
  if (!parsed.ok) return null;
  const { specs, capped } = planProbes(parsed);
  const source = instrument(field, range, specs);
  return source === null ? null : { source, specs, capped };
}

/** Kinds that carry nothing of the value they were derived from. */
const CONTENTLESS_KINDS: ReadonlySet<ValueSummary['kind']> = new Set([
  'boolean',
  'null',
  'undefined',
]);

/** What a probe keeps of a value: a read of a member named like a secret
 * (`input.apiKey`) is withheld whole, a value made from one keeps only a
 * flag or an absence, a value that shows one of the scope's secrets
 * (`JSON.stringify(input.login)`) is withheld whole, and any other value has
 * its secret-looking text withheld. */
function probeSummary(
  summary: ValueSummary,
  spec: ProbeSpec,
  secrets: readonly string[],
): ValueSummary {
  if (
    spec.secret === 'read' ||
    (spec.secret === 'derived' && !CONTENTLESS_KINDS.has(summary.kind)) ||
    summaryShowsSecret(summary, secrets)
  ) {
    return { kind: 'redacted' };
  }
  return redactSummary(summary);
}

/** The probes a runner answered, placed in the field (`offset` moves ranges
 * planned on the unit alone into its field). `secrets` are the texts of the
 * scope the expression read that no probe may show. */
function unitProbes(
  probes: ProbedResult['probes'],
  specs: readonly ProbeSpec[],
  offset: number,
  secrets: readonly string[],
): EvalUnitTrace['probes'] {
  const out: EvalUnitTrace['probes'] = [];
  for (const [k, summary] of probes) {
    const spec = specs[k];
    if (spec === undefined) continue;
    out.push({
      range: [spec.range[0] + offset, spec.range[1] + offset],
      v: probeSummary(summary, spec, secrets),
    });
  }
  return out;
}

/** A runner's failure to evaluate `expr`, worded and classified as
 * evalExpr words and classifies it. */
function runnerFailure(
  expr: string,
  error: unknown,
  where: ExprWhere | undefined,
): ExprError {
  const message = error instanceof Error ? error.message : String(error);
  return new ExprError(
    expr,
    `{{ ${expr} }} → ${message}`,
    exprFailureOf(message, expr, where, readsOf),
    error instanceof RunnerStopped,
  );
}

/**
 * One unit, evaluated as evalExpr evaluates it, recording into `unit` what
 * its sub-expressions held when the runner can probe. The value — and
 * whether and how the unit fails — are the plain evaluation's:
 *  - when the expression throws, it is evaluated once more without probes
 *    and that evaluation's error is thrown, so the failure reads exactly as
 *    an unprobed one (a probe can show in the JavaScript engine's own words:
 *    `__taleProbe$(...).map is not a function`); the unit keeps the probes
 *    taken until the throw;
 *  - when the probed evaluation timed out or did not answer readably, the
 *    unit is evaluated plainly, and that evaluation decides — probing never
 *    fails a condition the plain evaluation passes;
 *  - when the runner itself stopped (it killed or lost its process), nothing
 *    is evaluated again: the failure is the runner's.
 */
async function evalUnitTraced(
  field: string,
  unit: EvalUnitTrace | undefined,
  expr: string,
  scope: Record<string, unknown>,
  where: ExprWhere | undefined,
): Promise<unknown> {
  if (!hasCodeRunner()) return await evalExpr(expr, scope, where);
  const runner = codeRunner();
  if (unit === undefined || runner.evalExprProbed === undefined) {
    return await evalExpr(expr, scope, where);
  }
  const plan = probedUnit(field, unit.range, scope);
  if (plan === null) return await evalExpr(expr, scope, where);
  const pruned = scopeForSource(expr, 'expr', scope);
  let result: ProbedResult;
  try {
    result = await runner.evalExprProbed(plan.source, pruned, {
      timeoutMs: EXPR_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof RunnerStopped) {
      throw runnerFailure(expr, error, where);
    }
    return await evalExpr(expr, scope, where);
  }
  unit.probes = unitProbes(result.probes, plan.specs, 0, secretTextsIn(pruned));
  unit.probed = plan.capped ? 'partial' : 'full';
  if (result.error === undefined) return result.value;
  const value = await evalExpr(expr, scope, where);
  // The expression did not throw a second time — it read the clock or a
  // random number — so the probes belong to another evaluation.
  unit.probes = [];
  unit.probed = 'none';
  return value;
}

/** Where one `{{ }}` unit's output landed in the rendered text. */
export interface RenderedSpan {
  /** [start, end) of the unit's expression in the field. */
  unit: [number, number];
  /** [start, end) of its interpolated text in the rendered string. */
  out: [number, number];
}

/** Spans kept per field. */
export const RENDERED_SPANS_PER_FIELD = 32;

type UnitEvaluator = (
  expr: string,
  where: ExprWhere | undefined,
  index: number,
) => Promise<unknown>;

/** The failure evalTemplates raises for a unit that evaluated to null or
 * undefined inside text, in its words. */
function valueMissing(
  expr: string,
  v: null | undefined,
  value: string,
  where: ExprWhere | undefined,
): ExprError {
  return new ExprError(
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

/**
 * One string, evaluated as evalTemplates evaluates it, each unit through
 * `evaluate` (`index` counts the units in order): a single template keeps
 * its value's type, mixed text interpolates and refuses a missing value.
 * `spans`, when given, receives where each unit's text landed in mixed text.
 */
async function renderString(
  value: string,
  pointer: string | undefined,
  evaluate: UnitEvaluator,
  spans?: RenderedSpan[],
): Promise<unknown> {
  if (!value.includes('{{')) return value;
  const tokens = tokenizeTemplate(value);
  const exprs = tokens.segments.filter((s) => s.kind === 'expr');
  if (exprs.length === 0) return value;
  if (isSingleTemplate(value, tokens)) {
    return await evaluate(
      exprs[0].source ?? '',
      whereOf(pointer, unitRange(exprs[0])),
      0,
    );
  }
  let out = '';
  let index = 0;
  for (const segment of tokens.segments) {
    if (segment.kind === 'text') {
      out += value.slice(segment.start, segment.end);
      continue;
    }
    const expr = segment.source ?? '';
    const where = whereOf(pointer, unitRange(segment));
    const v = await evaluate(expr, where, index++);
    if (v === undefined || v === null) {
      throw valueMissing(expr, v, value, where);
    }
    const text = interpolate(v);
    if (spans !== undefined && spans.length < RENDERED_SPANS_PER_FIELD) {
      spans.push({
        unit: unitRange(segment),
        out: [out.length, out.length + text.length],
      });
    }
    out += text;
  }
  return out;
}

/**
 * `when` / `repeatUntil`: {@link evalCondition}, with the trace of how the
 * value was reached — each unit's sub-expression values when the runner can
 * probe (probe ranges are absolute in `cond`). Answers what
 * {@link evalCondition} answers and throws exactly when it would, in the
 * same words and with the same cause, the failure carrying the trace.
 */
export async function evalConditionTraced(
  cond: string,
  scope: Record<string, unknown>,
  pointer: string,
): Promise<TracedValue> {
  return await traced(cond, pointer, 'condition', async (units) => {
    if (cond.includes('{{')) {
      return await renderString(cond, pointer, (expr, where, index) =>
        evalUnitTraced(cond, units[index], expr, scope, where),
      );
    }
    return await evalUnitTraced(
      cond,
      units[0],
      cond.trim(),
      scope,
      whereOf(pointer, bareRange(cond)),
    );
  });
}

/** `forEach`: {@link evalTemplates} on one string, with the trace of how the
 * value was reached, as {@link evalConditionTraced} records it. Throws
 * exactly when {@link evalTemplates} would. */
export async function evalTemplateTraced(
  text: string,
  scope: Record<string, unknown>,
  pointer: string,
): Promise<TracedValue> {
  return await traced(text, pointer, 'template', async (units) =>
    renderString(text, pointer, (expr, where, index) =>
      evalUnitTraced(text, units[index], expr, scope, where),
    ),
  );
}

/** A value with its templates evaluated, and where each unit's text landed
 * in every mixed-text string, by the string's pointer. */
export interface RenderedValue {
  value: unknown;
  rendered: Record<string, RenderedSpan[]>;
}

/**
 * {@link evalTemplates} — the same value, thrown the same way — answering
 * also, for each string of mixed text and `{{ }}` units, where each unit's
 * output landed in the rendered string (the first
 * {@link RENDERED_SPANS_PER_FIELD} units), keyed by the string's pointer
 * under `pointer`. A string that is exactly one template keeps its value's
 * type and has no spans: the whole value is that unit's.
 */
export async function evalTemplatesRendered(
  value: unknown,
  scope: Record<string, unknown>,
  pointer: string,
): Promise<RenderedValue> {
  const rendered: Record<string, RenderedSpan[]> = {};
  const plain: UnitEvaluator = (expr, where) => evalExpr(expr, scope, where);
  const render = async (v: unknown, at: string): Promise<unknown> => {
    if (typeof v === 'string') {
      const spans: RenderedSpan[] = [];
      const out = await renderString(v, at, plain, spans);
      if (spans.length > 0) rendered[at] = spans;
      return out;
    }
    if (Array.isArray(v)) {
      const out = [];
      for (const [i, item] of v.entries())
        out.push(await render(item, at + ptr(i)));
      return out;
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v)) {
        out[k] = await render(item, at + ptr(k));
      }
      return out;
    }
    return v;
  };
  return { value: await render(value, pointer), rendered };
}

/** Whether a second, probed evaluation can explain a failure with this
 * reason: the expression threw (a timeout aside), or evaluated to nothing
 * inside text. */
function explains(reason: string): boolean {
  return (
    (reason.startsWith('EXPR_') && reason !== 'EXPR_TIMEOUT') ||
    reason === 'TEMPLATE_VALUE_MISSING'
  );
}

/**
 * Explain an expression that failed: evaluate it once more with probes, on
 * the scope it failed on, and attach what its sub-expressions held to the
 * failure as `failure.trace` — so the record can say which value was
 * missing (`nodes.fetch.output.items` read `undefined` when `.length` was
 * read). For an {@link ExprError} raised while evaluating a template or a
 * condition, placed in its field (`at.range`), not yet traced, and caused by
 * the expression itself rather than a timeout.
 *
 * Expressions are data-only and each evaluates in a fresh context, so the
 * second evaluation has no effect; it costs one runner round trip, on a
 * failure path only. Answers whether a trace was attached. Without a runner
 * that probes, for any other error, or when the second evaluation does not
 * fail the same way (an expression that reads the clock), it does nothing.
 * It never throws.
 */
export async function explainFailure(
  error: unknown,
  scope: Record<string, unknown>,
): Promise<boolean> {
  if (!(error instanceof ExprError) || error.stopped) return false;
  const { failure, expr } = error;
  const at = failure?.at;
  const range = at?.range;
  if (
    failure === undefined ||
    at === undefined ||
    range === undefined ||
    failure.trace !== undefined ||
    !explains(failure.reason) ||
    expr.length !== range[1] - range[0] ||
    !hasCodeRunner()
  ) {
    return false;
  }
  const runner = codeRunner();
  if (!runner.evalExprProbed) return false;
  const plan = probedUnit(expr, [0, expr.length], scope);
  if (plan === null) return false;
  const pruned = scopeForSource(expr, 'expr', scope);
  let result: ProbedResult;
  try {
    result = await runner.evalExprProbed(plan.source, pruned, {
      timeoutMs: EXPR_TIMEOUT_MS,
    });
  } catch (cause) {
    console.warn(
      '[engine] a failed expression could not be evaluated again to explain it:',
      cause instanceof Error ? cause.message : String(cause),
    );
    return false;
  }
  // The probes explain this failure only when the second evaluation failed
  // the same way: the same cause, or nothing again where text needed a value.
  const failedAgain =
    failure.reason === 'TEMPLATE_VALUE_MISSING'
      ? result.error === undefined &&
        (result.value === null || result.value === undefined)
      : result.error !== undefined &&
        exprFailureOf(result.error.message, expr, at, readsOf).reason ===
          failure.reason;
  if (!failedAgain) return false;
  failure.trace = {
    pointer: at.pointer,
    units: [
      {
        range: [range[0], range[1]],
        probes: unitProbes(
          result.probes,
          plan.specs,
          range[0],
          secretTextsIn(pruned),
        ),
        error: { message: error.message },
        probed: plan.capped ? 'partial' : 'full',
      },
    ],
  };
  return true;
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
