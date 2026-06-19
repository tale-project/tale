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

/**
 * Collect every bound function path in a view (Puck Data, or its `.data`
 * wrapper): a connected block's `query.path` + each action's `path`/`mode`.
 */
export function collectViewBindings(
  view: unknown,
): Array<{ path: string; mode: FunctionMode }> {
  const out: Array<{ path: string; mode: FunctionMode }> = [];
  const root = isRec(view) && isRec(view.data) ? view.data : view;
  const content =
    isRec(root) && Array.isArray(root.content) ? root.content : [];
  for (const node of content) {
    if (!isRec(node) || !isRec(node.props)) continue;
    const props = node.props;
    if (isRec(props.query) && typeof props.query.path === 'string') {
      out.push({ path: props.query.path, mode: 'query' });
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
 * call. `$orgId` → the current organization id; `$selected.<key>` → a field of
 * the selected master-detail row. Recurses through records + arrays.
 */
export function resolveBindingArgs(
  args: unknown,
  ctx: { organizationId: string; selected?: Record<string, unknown> },
): unknown {
  if (typeof args === 'string') {
    if (args === '$orgId') return ctx.organizationId;
    if (args === '$selected') return ctx.selected;
    if (args.startsWith('$selected.') && ctx.selected) {
      return ctx.selected[args.slice('$selected.'.length)];
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
