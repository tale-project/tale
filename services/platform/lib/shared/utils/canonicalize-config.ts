/**
 * Canonical-form helpers for JSON config files.
 *
 * Two concerns, kept separate because their safety profiles differ:
 *
 *  - **Object keys** — sorting them is *always* safe (JSON key order is never
 *    semantic) and makes both on-disk diffs and dirty-state comparison
 *    deterministic. {@link sortObjectKeysDeep} sorts every nested plain
 *    object.
 *  - **Arrays** — order is frequently semantic (a model fallback chain, the
 *    display order of conversation starters), so we *never* sort arrays
 *    blindly. {@link sortStringArrayFields} sorts only the explicitly named
 *    set-like fields (membership matters, order doesn't), and the per-domain
 *    canonicalizers below name exactly which fields qualify.
 *
 * Used in two places that must agree:
 *  - serialization (`serializeJson` + `serialize{Agent,Workflow}Json`) so the
 *    on-disk file is canonical, and
 *  - the editors' dirty-state equality so a reordered-but-equivalent config
 *    never reads as a false-positive unsaved change.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively return a copy of `value` with every plain object's keys sorted
 * lexicographically. Arrays keep their element order (their *contents* are
 * recursed so nested objects inside arrays are sorted too). Non-plain values
 * (primitives, `Date`, class instances) pass through untouched.
 */
export function sortObjectKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structural recursion preserves T
    return value.map((item) => sortObjectKeysDeep(item)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortObjectKeysDeep(value[key]);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rebuilt with same keys/values
    return sorted as T;
  }
  return value;
}

/**
 * Deterministic, locale-independent string order (UTF-16 code unit) — matches
 * `Object.keys().sort()` in {@link sortObjectKeysDeep} so canonical output is
 * byte-identical across machines and runtimes. `localeCompare` is not: its
 * ordering depends on the host ICU locale/version.
 */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lexicographic (code-unit) sort + dedupe of a string array. */
function sortStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort(byCodeUnit);
}

/**
 * Return a shallow clone of `config` with the named top-level fields sorted
 * (and deduped) when they hold string arrays. Fields that are absent or not
 * string arrays are left untouched. Use ONLY for set-like fields where the
 * order carries no meaning.
 */
export function sortStringArrayFields<T extends object>(
  config: T,
  fields: readonly string[],
): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- record reflection over a known object
  const next = { ...config } as Record<string, unknown>;
  for (const field of fields) {
    const value = next[field];
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === 'string')
    ) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guarded by every()
      next[field] = sortStrings(value as string[]);
    }
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same shape, sorted fields
  return next as T;
}

/**
 * Agent config fields whose arrays are sets (membership matters, order does
 * not). Deliberately EXCLUDES `supportedModels` (fallback priority chain) and
 * `conversationStarters` (display order) — sorting those would change runtime
 * or display behavior.
 */
const AGENT_SET_ARRAY_FIELDS = [
  'toolNames',
  'connectorBindings',
  'workflows',
  'skillBindings',
] as const;

/**
 * Canonicalize an agent config: sort the set-like string arrays and drop an
 * explicit `primaryBehavior: 'chat'` (the field is optional and every reader
 * resolves it as `config.primaryBehavior ?? 'chat'`, so the absent key and the
 * explicit default are the same effective config). Without this, the agent-type
 * switcher writing the resolved literal back reads as a permanent unsaved
 * change on legacy agents whose file never carried the key. Does not touch
 * ordered arrays. Pure — returns a new object.
 */
export function canonicalizeAgentConfig<T extends object>(config: T): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- record reflection over a known object
  const next = sortStringArrayFields(config, AGENT_SET_ARRAY_FIELDS) as Record<
    string,
    unknown
  >;
  if (next.primaryBehavior === 'chat') {
    delete next.primaryBehavior;
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same shape minus a redundant default
  return next as T;
}

/**
 * Canonicalize a workflow config: sort `steps` by `stepSlug` and
 * `requires.connectors` by `name` (with each connector's `operations`
 * sorted). Execution order is driven by each step's `order`/`nextSteps`, not
 * its array index, so sorting the steps array is safe and yields stable
 * diffs. Pure — returns a new object; absent fields are left as-is.
 */
export function canonicalizeWorkflowConfig<T extends object>(config: T): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- record reflection over a known object
  const next = { ...config } as Record<string, unknown>;

  const steps = next.steps;
  if (Array.isArray(steps)) {
    next.steps = [...steps].sort((a, b) => {
      const aSlug = isPlainObject(a) ? String(a.stepSlug ?? '') : '';
      const bSlug = isPlainObject(b) ? String(b.stepSlug ?? '') : '';
      return byCodeUnit(aSlug, bSlug);
    });
  }

  const requires = next.requires;
  if (isPlainObject(requires) && Array.isArray(requires.connectors)) {
    const connectors = requires.connectors.map((dep) => {
      if (isPlainObject(dep) && Array.isArray(dep.operations)) {
        return {
          ...dep,
          operations: sortStrings(
            dep.operations.filter((op): op is string => typeof op === 'string'),
          ),
        };
      }
      return dep;
    });
    connectors.sort((a, b) => {
      const aName = isPlainObject(a) ? String(a.name ?? '') : '';
      const bName = isPlainObject(b) ? String(b.name ?? '') : '';
      return byCodeUnit(aName, bName);
    });
    next.requires = { ...requires, connectors };
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same shape, sorted fields
  return next as T;
}
