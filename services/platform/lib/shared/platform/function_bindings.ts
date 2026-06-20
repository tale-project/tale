/**
 * The generic, capability-gated function-binding vocabulary — the "data freedom"
 * half of the configurable app surface. An app declares an ALLOWLIST of public
 * Convex functions it may call (`capabilities.functions`); a bound component or
 * action invokes one by its reference path. This is the open-ended successor to
 * the closed `data_sources` + `action_kinds` registries: any public function the
 * app declares, rather than a fixed set.
 *
 * Security posture (Phase 1, first-party authors): the allowlist is the app's
 * declared intent — validated at publish, checked client-side before dispatch,
 * and audited. The authoritative boundary remains each function's own auth/RLS
 * (every public Convex function gates itself) + the public/internal split
 * (internal functions are unreachable by a client reference). A server-side
 * dispatch gate that re-checks the allowlist is the Phase-3 hardening for
 * untrusted authors. Mirrors the `skillBindings`/`integrationBindings` model:
 * an explicit allowlist with no implicit fallback.
 */

import { interpolateTemplate } from '../utils/interpolate';

export const FUNCTION_MODES = ['query', 'mutation', 'action'] as const;
export type FunctionMode = (typeof FUNCTION_MODES)[number];

export interface FunctionBinding {
  /**
   * Convex function reference, in `makeFunctionReference` format:
   * `<dir>/<file>:<export>` (e.g. `tasks/queries:listTasksByOrg`). The slash
   * separates path segments; the colon precedes the export name.
   */
  path: string;
  mode: FunctionMode;
}

const PATH_RE = /^[a-zA-Z0-9_]+(\/[a-zA-Z0-9_]+)*:[a-zA-Z0-9_]+$/;

export function isFunctionMode(value: string): value is FunctionMode {
  return (FUNCTION_MODES as readonly string[]).includes(value);
}

/** Shape check for a reference path (not existence — that's verified at runtime). */
export function isValidFunctionPath(path: string): boolean {
  return PATH_RE.test(path);
}

/** Whether `path` is declared in the app's allowlist (optionally requiring `mode`). */
export function isFunctionAllowed(
  path: string,
  allowlist: readonly FunctionBinding[] | undefined,
  mode?: FunctionMode,
): boolean {
  if (!allowlist) return false;
  return allowlist.some(
    (b) => b.path === path && (mode === undefined || b.mode === mode),
  );
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type CollectedBinding = { path: string; mode: FunctionMode };

/** Collect bindings from one Puck Data document's `content` (block props). */
function collectFromData(data: unknown, out: CollectedBinding[]): void {
  const content =
    isRec(data) && Array.isArray(data.content) ? data.content : [];
  for (const node of content) {
    if (!isRec(node) || !isRec(node.props)) continue;
    const props = node.props;
    if (isRec(props.query) && typeof props.query.path === 'string') {
      out.push({ path: props.query.path, mode: 'query' });
    }
    // An action-sourced list (`ExternalList`) declares its data fetch under
    // `source`, not `query`; collect it so it's allowlist-checked like the rest.
    if (isRec(props.source) && typeof props.source.path === 'string') {
      const mode =
        typeof props.source.mode === 'string' &&
        isFunctionMode(props.source.mode)
          ? props.source.mode
          : 'action';
      out.push({ path: props.source.path, mode });
    }
    if (Array.isArray(props.actions)) {
      for (const a of props.actions) {
        if (
          isRec(a) &&
          typeof a.path === 'string' &&
          typeof a.mode === 'string' &&
          isFunctionMode(a.mode)
        ) {
          out.push({ path: a.path, mode: a.mode });
        }
      }
    }
  }
}

/**
 * Collect every bound function path in a view — across the whole layout: a flat
 * `data` document, a bare Puck Data (`content` at top level), or a tabbed shell
 * (`tabs[].data` + `tabs[].columns[]`). Each connected block's `query.path` +
 * each action's `path`/`mode`.
 */
export function collectViewBindings(view: unknown): CollectedBinding[] {
  const out: CollectedBinding[] = [];
  if (!isRec(view)) return out;
  if (isRec(view.data)) collectFromData(view.data, out);
  if (Array.isArray(view.content)) collectFromData(view, out);
  if (Array.isArray(view.tabs)) {
    for (const tab of view.tabs) {
      if (!isRec(tab)) continue;
      if (isRec(tab.data)) collectFromData(tab.data, out);
      if (Array.isArray(tab.columns)) {
        for (const col of tab.columns) collectFromData(col, out);
      }
    }
  }
  return out;
}

/**
 * Publish-time check: every bound path in a view is well-formed AND declared in
 * the app's allowlist with a matching mode. Returns human-readable errors (empty
 * = valid). The runtime hooks enforce the same gate at dispatch.
 */
export function validateViewBindings(
  view: unknown,
  allowlist: readonly FunctionBinding[] | undefined,
): string[] {
  const errors: string[] = [];
  for (const b of collectViewBindings(view)) {
    if (!isValidFunctionPath(b.path)) {
      errors.push(`malformed function path "${b.path}"`);
    } else if (!isFunctionAllowed(b.path, allowlist, b.mode)) {
      errors.push(
        `function "${b.path}" (${b.mode}) is not in capabilities.functions`,
      );
    }
  }
  return errors;
}

/**
 * Runtime arg-template substitution. A view authors args with sentinels so they
 * stay data; the binding hooks resolve them against the live context before the
 * call. Recurses through records + arrays. Whole-string sentinels:
 *  - `$orgId` → the current organization id;
 *  - `$selected` / `$selected.<key>` → the selected row, or one of its fields;
 *  - `$result` / `$result.<key>` → the just-resolved action result (used by
 *    `onSuccess` effects to read e.g. a created id).
 * Prefix templates (interpolated over the selected row, `{field}` syntax):
 *  - `$tpl:…{field}…` → the suffix as an `interpolateTemplate` over the row, so
 *    an arg can embed row fields (e.g. `"$tpl:{owner}/{repo}#{number}"`);
 *  - `$label:<key>` → the pack label `key` (from `ctx.labels`, else the key
 *    itself) interpolated over the row — a localized, row-templated string.
 */
export function resolveBindingArgs(
  args: unknown,
  ctx: {
    organizationId: string;
    selected?: Record<string, unknown>;
    result?: Record<string, unknown>;
    labels?: Record<string, string>;
  },
): unknown {
  if (typeof args === 'string') {
    if (args === '$orgId') return ctx.organizationId;
    if (args === '$selected') return ctx.selected;
    if (args.startsWith('$selected.') && ctx.selected) {
      return ctx.selected[args.slice('$selected.'.length)];
    }
    if (args === '$result') return ctx.result;
    if (args.startsWith('$result.') && ctx.result) {
      return ctx.result[args.slice('$result.'.length)];
    }
    if (args.startsWith('$tpl:')) {
      return interpolateTemplate(
        args.slice('$tpl:'.length),
        ctx.selected ?? {},
      );
    }
    if (args.startsWith('$label:')) {
      const key = args.slice('$label:'.length);
      return interpolateTemplate(ctx.labels?.[key] ?? key, ctx.selected ?? {});
    }
    return args;
  }
  if (Array.isArray(args)) {
    return args.map((a) => resolveBindingArgs(a, ctx));
  }
  if (args !== null && typeof args === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      out[k] = resolveBindingArgs(v, ctx);
    }
    return out;
  }
  return args;
}
