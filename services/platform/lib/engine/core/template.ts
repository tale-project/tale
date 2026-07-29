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
 * The scanners (`templateExprsIn`, `refsInSource`, `inputKeysInSource`) are
 * pure and synchronous — validation derives the dependency graph from them
 * without executing anything.
 */

import { codeRunner } from './runner';

export class ExprError extends Error {
  constructor(
    public expr: string,
    message: string,
  ) {
    super(message);
  }
}

export const TPL_RE = /\{\{([\s\S]+?)\}\}/g;

/** Collect template expressions from all strings nested in a value. */
export function templateExprsIn(value: unknown): string[] {
  const out: string[] = [];
  walkStrings(value, (s) => {
    for (const m of s.matchAll(TPL_RE)) out.push(m[1].trim());
  });
  return out;
}

function walkStrings(v: unknown, fn: (s: string) => void): void {
  if (typeof v === 'string') fn(v);
  else if (Array.isArray(v)) {
    for (const x of v) walkStrings(x, fn);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) walkStrings(x, fn);
  }
}

/** Node ids referenced as `nodes.foo` / `nodes["foo"]` in a JS source
 * string — the derived-edge scanner. */
export function refsInSource(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\bnodes\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]);
  }
  for (const m of src.matchAll(/\bnodes\s*\[\s*["']([^"']+)["']\s*\]/g)) {
    out.add(m[1]);
  }
  return out;
}

/** `input.<key>` references, for typo-checking against the inputs schema. */
export function inputKeysInSource(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\binput\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]);
  }
  return out;
}

/** Expression evaluation budget. Expressions are lookups and small
 * reshapes; anything that needs longer belongs in a transform node. */
const EXPR_TIMEOUT_MS = 100;

async function evalExpr(
  expr: string,
  scope: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await codeRunner().evalExpr(expr, scope, {
      timeoutMs: EXPR_TIMEOUT_MS,
    });
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
    const matches = [...value.matchAll(TPL_RE)];
    if (matches.length === 0) return value;
    if (matches.length === 1 && matches[0][0] === value.trim()) {
      return await evalExpr(matches[0][1].trim(), scope);
    }
    let out = '';
    let last = 0;
    for (const m of matches) {
      const expr = m[1].trim();
      const v = await evalExpr(expr, scope);
      if (v === undefined || v === null) {
        throw new ExprError(
          expr,
          `template {{ ${expr} }} evaluated to ${String(v)} inside the string ${JSON.stringify(value.slice(0, 80))} — the referenced value does not exist. Check the exact output shape in the trace and your run input.`,
        );
      }
      out += value.slice(last, m.index) + interpolate(v);
      last = (m.index ?? 0) + m[0].length;
    }
    return out + value.slice(last);
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
    return await codeRunner().runBody(code, scope, { timeoutMs });
  } catch (e) {
    throw new ExprError('[code]', e instanceof Error ? e.message : String(e));
  }
}
