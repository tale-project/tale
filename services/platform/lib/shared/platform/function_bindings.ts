/**
 * The generic, capability-gated function-binding vocabulary — the "data freedom"
 * half of the configurable app surface. An app declares an ALLOWLIST of public
 * Convex functions it may call (`capabilities.functions`); a bound component or
 * action invokes one by its reference path — any public function the app
 * declares, rather than a fixed, platform-defined set of named data-sources and
 * action verbs.
 *
 * Security posture (Phase 1, first-party authors): the allowlist is the app's
 * declared intent — validated at publish, checked client-side before dispatch,
 * and audited. The authoritative boundary remains each function's own auth/RLS
 * (every public Convex function gates itself) + the public/internal split
 * (internal functions are unreachable by a client reference). A server-side
 * dispatch gate that re-checks the allowlist is the Phase-3 hardening for
 * untrusted authors. Mirrors the `skillBindings`/`connectorBindings` model:
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

function isFunctionMode(value: string): value is FunctionMode {
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

/**
 * Named single-action props the collector walks — each a `{path, mode}` bound
 * action, collected exactly like an `actions[]` entry: `Board.move`,
 * `Form`/`MessageComposer` `submit`, `MessageComposer.improve`,
 * `ConversationList.onOpen`, `ConversationThread.attachmentAction`,
 * `Collection.addAction` (the header create affordance).
 */
const SINGLE_ACTION_PROPS = [
  'move',
  'submit',
  'improve',
  'onOpen',
  'attachmentAction',
  'addAction',
] as const;

/** Push one `{path, mode}` bound-action record (skips malformed shapes). */
function pushBoundAction(a: unknown, out: CollectedBinding[]): void {
  if (
    isRec(a) &&
    typeof a.path === 'string' &&
    typeof a.mode === 'string' &&
    isFunctionMode(a.mode)
  ) {
    out.push({ path: a.path, mode: a.mode });
  }
}

/** Collect bindings from one block node's props. */
function collectFromNode(node: unknown, out: CollectedBinding[]): void {
  if (!isRec(node) || !isRec(node.props)) return;
  const props = node.props;
  if (isRec(props.query) && typeof props.query.path === 'string') {
    out.push({ path: props.query.path, mode: 'query' });
  }
  // Optional visibility gate (`Form` / `Text` / `Alert` `whenQuery`) — a
  // reactive read like `props.query`, collected so publish allowlists it.
  if (isRec(props.whenQuery) && typeof props.whenQuery.path === 'string') {
    out.push({ path: props.whenQuery.path, mode: 'query' });
  }
  // A list block may cross-reference a second reactive query under `excludeBy`
  // (hide rows already materialized elsewhere); collect it so the cross-ref
  // query is allowlist-checked like any other binding.
  if (
    isRec(props.excludeBy) &&
    isRec(props.excludeBy.query) &&
    typeof props.excludeBy.query.path === 'string'
  ) {
    out.push({ path: props.excludeBy.query.path, mode: 'query' });
  }
  // An action-sourced list (`ExternalList`) declares its data fetch under
  // `source`, not `query`; collect it so it's allowlist-checked like the rest.
  if (isRec(props.source) && typeof props.source.path === 'string') {
    const mode =
      typeof props.source.mode === 'string' && isFunctionMode(props.source.mode)
        ? props.source.mode
        : 'action';
    out.push({ path: props.source.path, mode });
  }
  if (Array.isArray(props.actions)) {
    for (const a of props.actions) pushBoundAction(a, out);
  }
  // Named single-action props (Board `move`, Form/Composer `submit`, …).
  for (const key of SINGLE_ACTION_PROPS) pushBoundAction(props[key], out);
  // A secondary read binding (`ConversationList.count`) — a query like
  // `props.query` (per-status totals for tab badges).
  if (isRec(props.count) && typeof props.count.path === 'string') {
    out.push({ path: props.count.path, mode: 'query' });
  }
  // Multi-select bulk actions (args bind ids via `$selection.ids`) — the same
  // shape as `actions[]`.
  if (Array.isArray(props.bulkActions)) {
    for (const a of props.bulkActions) pushBoundAction(a, out);
  }
}

/** Collect bindings from one Puck Data document — its `content` array plus
 *  every dropzone array under `zones` (Puck stores zone children per zone id
 *  at the document level, siblings of `content`). */
function collectFromData(data: unknown, out: CollectedBinding[]): void {
  if (!isRec(data)) return;
  if (Array.isArray(data.content)) {
    for (const node of data.content) collectFromNode(node, out);
  }
  if (isRec(data.zones)) {
    for (const zone of Object.values(data.zones)) {
      if (!Array.isArray(zone)) continue;
      for (const node of zone) collectFromNode(node, out);
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
 *  - `$projectId` → the bound project id (undefined when unbound);
 *  - `$projectName` → the bound project's display name (undefined until loaded);
 *  - `$selected` / `$selected.<key>` → the selected row, or one of its fields;
 *  - `$result` / `$result.<key>` → the just-resolved action result (used by
 *    `onSuccess` effects to read e.g. a created id).
 *  - `$config:<key>` → the app's per-install config value for `key` (from
 *    `ctx.config`, e.g. a configured github `owner`/`repo`); undefined if unset.
 *    This is what keeps an app repo-agnostic — the operator's target is data, not
 *    a hardcoded literal.
 *  - `$state.<key>` → a cross-block view-state value (from `ctx.state`, the
 *    view's `ViewStateProvider` — e.g. a master-detail `conversationId`);
 *  - `$selection.ids` → the invoking block's multi-select ids
 *    (`ctx.selectionIds`, for bulk actions);
 *  - `$input.<field>` → a Form/Composer submit value (`ctx.input`);
 *  - `$lane` → the Board drop-target lane (`ctx.lane`).
 *    These four resolve to `undefined` when the referenced value is unavailable
 *    (state key unset, nothing selected, …) — the `$config:` posture — so
 *    `bindingArgsResolved` gates the call and the block shows its awaiting
 *    placeholder instead of firing a malformed request.
 * Prefix templates (interpolated over the row MERGED WITH config, form input,
 * and bound ids — `{field}` syntax; later layers win a name clash):
 *  - `$tpl:…{field}…` → the suffix as an `interpolateTemplate` over
 *    `{...config, ...selected, ...input, projectId, orgId}`, so one arg can
 *    mix config + row + form fields (e.g. `"$tpl:{owner}/{repo}#{number}"` —
 *    owner/repo from config, number from the row; or
 *    `"$tpl:vatplus:{projectId}:profile.yaml"` from a Form submit).
 */
export function resolveBindingArgs(
  args: unknown,
  ctx: {
    organizationId: string;
    /** Bound project id for a project-scoped app; undefined for org-scoped apps. */
    projectId?: string;
    /** Bound project display name (`$projectName`); undefined until loaded. */
    projectName?: string;
    selected?: Record<string, unknown>;
    result?: Record<string, unknown>;
    /** The app's per-install config values (`$config:`/template `{key}`). */
    config?: Record<string, unknown>;
    /** Cross-block view state (`$state.<key>`) — the view's `ViewStateProvider`. */
    state?: Record<string, unknown>;
    /** The invoking block's multi-select ids (`$selection.ids`). */
    selectionIds?: string[];
    /** Form/Composer submit values (`$input.<field>`). */
    input?: Record<string, unknown>;
    /** Board drop-target lane (`$lane`). */
    lane?: string;
  },
): unknown {
  // Templates can reference config, the selected row, form input, and the
  // bound project/org ids. Later layers win a name clash (input is the most
  // specific per-submit value).
  const templateScope = {
    ...ctx.config,
    ...ctx.selected,
    ...ctx.input,
    ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    ...(ctx.projectName !== undefined ? { projectName: ctx.projectName } : {}),
    orgId: ctx.organizationId,
  };
  if (typeof args === 'string') {
    if (args === '$orgId') return ctx.organizationId;
    // Unbound `$projectId` resolves to `undefined` (the `$config:` / `$state.`
    // posture) so `bindingArgsResolved` is false and callers gate the call —
    // an org-route visit to a project-scoped view shows an empty state instead
    // of firing Convex with the literal `"$projectId"`.
    if (args === '$projectId') return ctx.projectId;
    if (args === '$projectName') return ctx.projectName;
    if (args === '$selected') return ctx.selected;
    if (args.startsWith('$selected.') && ctx.selected) {
      return ctx.selected[args.slice('$selected.'.length)];
    }
    if (args === '$result') return ctx.result;
    if (args.startsWith('$result.') && ctx.result) {
      return ctx.result[args.slice('$result.'.length)];
    }
    if (args.startsWith('$config:')) {
      return ctx.config?.[args.slice('$config:'.length)];
    }
    // View-state sentinels: resolve to `undefined` (NOT the literal) when the
    // referenced value is unavailable — the `$config:` posture — so
    // `bindingArgsResolved` returns false and the caller gates the call.
    if (args === '$lane') return ctx.lane;
    if (args === '$selection.ids') return ctx.selectionIds;
    if (args.startsWith('$state.')) {
      return ctx.state?.[args.slice('$state.'.length)];
    }
    if (args.startsWith('$input.')) {
      return ctx.input?.[args.slice('$input.'.length)];
    }
    if (args.startsWith('$tpl:')) {
      return interpolateTemplate(args.slice('$tpl:'.length), templateScope);
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

/**
 * Whether a resolved args tree is fully bound — i.e. holds no `undefined`. A
 * `$config:<key>` (or `$projectId` / `$selected.` / `$result.` / `$state.` /
 * `$input.` / `$lane` / `$selection.ids`) reference whose value is absent
 * resolves to `undefined`; a literal / `$orgId` never does. So an `undefined`
 * anywhere means a binding the live context couldn't satisfy yet — typically
 * an app whose `requires.config` hasn't been filled in, or a project-scoped
 * view opened without a project. Callers gate the actual call on this so an
 * unconfigured view shows an empty state instead of firing a malformed
 * request (e.g. `listGitHubIssues` missing `owner`).
 */
export function bindingArgsResolved(resolved: unknown): boolean {
  if (resolved === undefined) return false;
  if (Array.isArray(resolved)) return resolved.every(bindingArgsResolved);
  if (resolved !== null && typeof resolved === 'object') {
    return Object.values(resolved as Record<string, unknown>).every(
      bindingArgsResolved,
    );
  }
  return true;
}

/**
 * Whether an authored args tree references cross-block view state — i.e. the
 * block is wired to a selection a sibling block writes (`$state.<key>`). Scans
 * the RAW args (before resolution), matching `resolveBindingArgs`' string
 * grammar: only whole values starting with `$state.` are state reads. The
 * bound hooks report every unresolved binding as `needsConfig`; a block whose
 * args bind view state reads that as "awaiting selection" instead (the
 * `BindingStates.awaitingState` flavor) — e.g. a ConversationThread before
 * any conversation is selected.
 */
export function argsReferenceViewState(args: unknown): boolean {
  if (typeof args === 'string') return args.startsWith('$state.');
  if (Array.isArray(args)) return args.some(argsReferenceViewState);
  if (args !== null && typeof args === 'object') {
    return Object.values(args as Record<string, unknown>).some(
      argsReferenceViewState,
    );
  }
  return false;
}

/**
 * Whether an authored args tree references `$projectId` — i.e. the block is
 * project-scoped. Same scan shape as `argsReferenceViewState`. Bound hooks
 * report an unbound `$projectId` as `needsConfig`; callers that detect this
 * sentinel read it as "open from a project" (`BindingStates.needsProject`)
 * instead of the generic configure prompt.
 */
export function argsReferenceProjectId(args: unknown): boolean {
  if (typeof args === 'string') return args === '$projectId';
  if (Array.isArray(args)) return args.some(argsReferenceProjectId);
  if (args !== null && typeof args === 'object') {
    return Object.values(args as Record<string, unknown>).some(
      argsReferenceProjectId,
    );
  }
  return false;
}
