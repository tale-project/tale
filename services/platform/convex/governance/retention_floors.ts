/**
 * Pure helpers for resolving effective retention bounds from per-org
 * file content + env tightening. **No fs, no Convex ctx, no `'use node'`** —
 * importable from V8 mutations / queries / actions.
 *
 * Resolution order:
 *   1. **Per-org file** at `$TALE_CONFIG_DIR/retention/{orgSlug}.json`
 *      provides the baseline `{ min, max, default }` per category. The
 *      file is the canonical source of truth (no in-code fallback).
 *      Loading the file is the caller's responsibility — Node-side
 *      callers (cleanup action) import the store directly; V8-side
 *      callers (the editor's V8 action wrapper) call `ctx.runAction(
 *      internal.lib.config_store.actions.readRetentionConfig, ...)`.
 *      If the org's own file is missing, the wrapper falls back to the
 *      `default` org's file. If both are missing, throws
 *      `RetentionConfigMissingError`.
 *   2. **Env-var operator overrides** declared explicitly via the file's
 *      root `_metadata.envNames` — a 1:1 map from env-name suffix to the
 *      JSON object path the env controls (e.g. `"AUDIT_MIN":
 *      "auditLog.min"`). Full env name = `${envPrefix}${suffix}` (plain
 *      string concatenation — `envPrefix` carries any trailing
 *      separator like `_` itself, so nothing is implicit). If
 *      `envPrefix` is omitted, suffix keys are full env names.
 *        - For `min` / `max` the override TIGHTENS (raises floor /
 *          lowers ceiling); env values that try to widen are silently
 *          ignored.
 *        - For `default` the override REPLACES the seed value used
 *          when an admin first opens the editor; runtime cleanup
 *          doesn't read it.
 *      Fields not represented in `envNames` get no env binding (the
 *      editor surfaces this in the Environment admin page).
 *
 * `TALE_RETENTION_DISABLED=true` short-circuits the cleanup action
 * with a single warn-log (operator kill-switch for migration windows).
 *
 * NOTE: Convex caches env at process start. Operators changing env
 * vars must restart the Convex backend container for the new bounds
 * to take effect; see docs/self-hosted/configuration/retention.md.
 */

import {
  RETENTION_CATEGORIES,
  type RetentionCategory,
  type RetentionDefaultsConfig,
} from '../../lib/shared/schemas/retention';

/**
 * Per-binding env-resolution detail. Captured per `min` / `max` /
 * `default` so the editor + admin Environment page can show "this
 * field is currently env-bound to MY_FOO_BAR." When the file's
 * `_metadata.envNames` has no entry for a field, that field has no env
 * binding — `envName` is the empty string and `source` is `'none'`.
 */
export interface EnvBinding {
  /** The resolved env var name, or `''` when the field has no binding. */
  envName: string;
  /** Where the binding came from. `'metadata'` = declared in
   *  `_metadata.envNames` in the JSON. `'none'` = no binding. */
  source: 'metadata' | 'none';
  /** Whether `process.env[envName]` was set (and thus tightening). */
  applied: boolean;
}

export interface EffectiveBoundDef {
  category: RetentionCategory;
  min: number;
  max: number;
  default: number;
  /** Time unit for `min`/`max`/`default` — sourced from the JSON file
   *  (single SoT), refined to match the category id naming convention
   *  (`*Hours` → 'hours', else 'days'). */
  unit: 'days' | 'hours';
  /** `'env'` when env-var TIGHTENED min or max from the file value. */
  source: 'file' | 'env';
  /** Resolution detail for the `min` env binding. */
  minEnv: EnvBinding;
  /** Resolution detail for the `max` env binding. */
  maxEnv: EnvBinding;
  /** Resolution detail for the `default` env binding. */
  defaultEnv: EnvBinding;
}

function parseEnvNumber(name: string): number | null {
  // Convex enforces env-var name length (< 40 chars). Defensive try/catch
  // so a too-long name (which the schema validates against, but a stale
  // process could still hit) doesn't crash every retention-bounds query
  // across the deployment. Surfaces as a console warning instead.
  let raw: string | undefined;
  try {
    raw = process.env[name];
  } catch (error) {
    console.warn(
      `[retention_floors] process.env[${name}] threw — likely a too-long env name (>= 40 chars). Falling back to file value.`,
      error,
    );
    return null;
  }
  if (raw === undefined || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  // `0` is invalid (silently honoring it would collapse `Math.min(file_max, 0)
  // = 0` and brick every retention save with `RETENTION_EXCEEDS_CEILING`).
  // Throwing here would propagate uncaught and brick every save / cleanup /
  // bounds query deployment-wide on a single operator typo. Log loudly and
  // fall back to the file value instead.
  if (n === 0) {
    console.error(
      `[retention_floors] ${name}=0 is not a valid retention bound; ignoring and using file value. Unset the variable or set a positive integer.`,
    );
    return null;
  }
  return n;
}

/**
 * Reverse map keyed by `${category}.${field}` JSON path → fully-formed
 * env name (`envPrefix` already prepended). Built once per resolution
 * pass so per-field lookups are O(1).
 *
 * If the file has no root `_metadata.envNames`, the result is empty
 * and every category resolves to `source: 'none'` for every field.
 */
type PathToEnv = Map<string, string>;

function buildPathToEnvMap(
  orgConfig: RetentionDefaultsConfig | null,
): PathToEnv {
  const out: PathToEnv = new Map();
  const meta = orgConfig?._metadata;
  if (!meta?.envNames) return out;
  const prefix = meta.envPrefix ?? '';
  for (const [suffix, path] of Object.entries(meta.envNames)) {
    out.set(path, `${prefix}${suffix}`);
  }
  return out;
}

function buildEnvBinding(
  pathToEnv: PathToEnv,
  category: RetentionCategory,
  fieldKey: 'min' | 'max' | 'default',
): { envName: string; source: 'metadata' | 'none' } {
  const envName = pathToEnv.get(`${category}.${fieldKey}`);
  if (!envName) return { envName: '', source: 'none' };
  return { envName, source: 'metadata' };
}

/**
 * Apply env tightening to a single category's file-loaded bound. Pure
 * function — caller has already loaded the file content (or `null`)
 * via the appropriate IO path (Node store directly, or V8 → internal
 * action). Throws `RetentionConfigMissingError` when the file has no
 * entry for the category and the caller should fall back to the
 * `default` org's file.
 *
 * Resolves env binding via the root `_metadata.envNames` map (path →
 * env-suffix), then TIGHTENS min/max and OVERRIDES default based on
 * the resolved env vars' current values.
 */
export function applyEnvTightening(
  orgConfig: RetentionDefaultsConfig | null,
  category: RetentionCategory,
): EffectiveBoundDef {
  return applyEnvTighteningWithMap(
    orgConfig,
    category,
    buildPathToEnvMap(orgConfig),
  );
}

function applyEnvTighteningWithMap(
  orgConfig: RetentionDefaultsConfig | null,
  category: RetentionCategory,
  pathToEnv: PathToEnv,
): EffectiveBoundDef {
  const base = orgConfig?.[category];
  if (!base) {
    throw new RetentionConfigMissingError(category);
  }

  const minBinding = buildEnvBinding(pathToEnv, category, 'min');
  const maxBinding = buildEnvBinding(pathToEnv, category, 'max');
  const defaultBinding = buildEnvBinding(pathToEnv, category, 'default');

  const envMin = minBinding.envName ? parseEnvNumber(minBinding.envName) : null;
  const envMax = maxBinding.envName ? parseEnvNumber(maxBinding.envName) : null;
  const envDefault = defaultBinding.envName
    ? parseEnvNumber(defaultBinding.envName)
    : null;

  const min = Math.max(base.min, envMin ?? 0);
  const maxRaw = Math.min(base.max, envMax ?? Number.POSITIVE_INFINITY);
  const defaultVal = envDefault ?? base.default;

  // Operator misconfiguration: env _MIN > env _MAX (or env _MIN > file
  // max, or env _MAX < file min) produces an unsatisfiable bounds
  // window. `clampToBounds` would silently return `min` (which itself
  // exceeds `max`); `assertWithinBounds` would reject every value.
  // Fail loudly at config-load with both env names so the operator can
  // fix the typo, instead of letting the broken bounds reach runtime.
  if (min > maxRaw) {
    const minLabel = minBinding.envName ?? 'file.min';
    const maxLabel = maxBinding.envName ?? 'file.max';
    throw new Error(
      `Retention env config for ${category} is unsatisfiable: effective min (${min}) > max (${Number.isFinite(maxRaw) ? maxRaw : base.max}). Check ${minLabel} and ${maxLabel}.`,
    );
  }

  return {
    category,
    min,
    max: Number.isFinite(maxRaw) ? maxRaw : base.max,
    default: defaultVal,
    unit: base.unit,
    source: envMin !== null || envMax !== null ? 'env' : 'file',
    minEnv: { ...minBinding, applied: envMin !== null },
    maxEnv: { ...maxBinding, applied: envMax !== null },
    defaultEnv: { ...defaultBinding, applied: envDefault !== null },
  };
}

/**
 * Snapshot of every category's effective bounds, given the loaded file
 * content. Convenience wrapper over `applyEnvTightening` for the
 * editor's "show all 16 rows" view. Builds the path→env map once and
 * reuses it across categories.
 */
export function applyEnvTighteningAll(
  orgConfig: RetentionDefaultsConfig | null,
): EffectiveBoundDef[] {
  const pathToEnv = buildPathToEnvMap(orgConfig);
  return RETENTION_CATEGORIES.map((cat) =>
    applyEnvTighteningWithMap(orgConfig, cat, pathToEnv),
  );
}

/**
 * Build a `category → EffectiveBoundDef` map for clamp-config use.
 */
export function buildBoundsByCategory(
  orgConfig: RetentionDefaultsConfig | null,
): Record<RetentionCategory, EffectiveBoundDef> {
  const pathToEnv = buildPathToEnvMap(orgConfig);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exhaustive over RETENTION_CATEGORIES
  const out = {} as Record<RetentionCategory, EffectiveBoundDef>;
  for (const cat of RETENTION_CATEGORIES) {
    out[cat] = applyEnvTighteningWithMap(orgConfig, cat, pathToEnv);
  }
  return out;
}

/**
 * `TALE_RETENTION_DISABLED=true` short-circuits the cleanup action with
 * a single warn-log. Used during migration windows or for emergency
 * "freeze all auto-deletion this week" scenarios. Sync (env-only).
 */
export function isRetentionDisabled(): boolean {
  return process.env.TALE_RETENTION_DISABLED === 'true';
}

/**
 * Throws if `value` is outside `[boundDef.min, boundDef.max]`. Caller
 * catches and converts to a `ConvexError` with the specific code.
 */
export function assertWithinBounds(
  boundDef: EffectiveBoundDef,
  value: number,
): void {
  if (value < boundDef.min) {
    throw new RetentionBoundsViolation('RETENTION_BELOW_FLOOR', {
      category: boundDef.category,
      requested: value,
      bound: boundDef.min,
      source: boundDef.source,
    });
  }
  if (value > boundDef.max) {
    throw new RetentionBoundsViolation('RETENTION_EXCEEDS_CEILING', {
      category: boundDef.category,
      requested: value,
      bound: boundDef.max,
      source: boundDef.source,
    });
  }
}

export class RetentionBoundsViolation extends Error {
  readonly code: 'RETENTION_BELOW_FLOOR' | 'RETENTION_EXCEEDS_CEILING';
  readonly category: RetentionCategory;
  readonly requested: number;
  readonly bound: number;
  readonly source: 'file' | 'env';

  constructor(
    code: 'RETENTION_BELOW_FLOOR' | 'RETENTION_EXCEEDS_CEILING',
    detail: {
      category: RetentionCategory;
      requested: number;
      bound: number;
      source: 'file' | 'env';
    },
  ) {
    super(
      `${code}: category=${detail.category} requested=${detail.requested} bound=${detail.bound} source=${detail.source}`,
    );
    this.code = code;
    this.category = detail.category;
    this.requested = detail.requested;
    this.bound = detail.bound;
    this.source = detail.source;
  }
}

export class RetentionConfigMissingError extends Error {
  readonly category: RetentionCategory;
  readonly hint: string;
  constructor(category: RetentionCategory) {
    const hint =
      'Copy examples/retention/default.json to $TALE_CONFIG_DIR/retention/default.json';
    super(`Retention config missing for category=${category}. ${hint}`);
    this.category = category;
    this.hint = hint;
  }
}

/**
 * Clamp a stored config value to current bounds at cleanup time. Used
 * as defense-in-depth against rows persisted before a tightening file
 * or env change.
 */
export function clampToBounds(
  boundDef: EffectiveBoundDef,
  value: number,
): number {
  if (value < boundDef.min) return boundDef.min;
  if (value > boundDef.max) return boundDef.max;
  return value;
}

/**
 * Map of every retention-config field to its `RetentionCategory`. Drives
 * `clampConfigToBounds` so an org's stored values never bypass freshly
 * tightened bounds, even when the row was persisted under the old
 * config.
 */
const CONFIG_FIELD_TO_CATEGORY: Record<string, RetentionCategory> = {
  documentsRetentionDays: 'documents',
  userTempRetentionHours: 'userTempHours',
  agentTempRetentionHours: 'agentTempHours',
  chatHistoryRetentionDays: 'chatHistory',
  auditLogRetentionDays: 'auditLog',
  workflowLogRetentionDays: 'workflowLog',
  usageLedgerRetentionDays: 'usageLedger',
  loginAttemptRetentionDays: 'loginAttempt',
  chatFilterEventsRetentionDays: 'chatFilterEvents',
  messageFeedbackRetentionDays: 'messageFeedback',
  memoryAuditRetentionDays: 'memoryAudit',
  customersRetentionDays: 'customers',
  vendorsRetentionDays: 'vendors',
  externalConversationsRetentionDays: 'externalConversations',
  messageMetadataRetentionDays: 'messageMetadata',
  notificationsRetentionDays: 'notifications',
};

/**
 * Clamp every retention-config field to current effective bounds.
 * Returns a shallow-cloned config; original is unchanged. Fields absent
 * from the input or whose value is non-numeric are left untouched.
 *
 * Pure: takes a pre-resolved `boundsByCategory` map. Build it via
 * `buildBoundsByCategory(orgConfig)` after loading the file at the IO
 * boundary.
 */
export function clampConfigToBounds<C extends Record<string, unknown>>(
  boundsByCategory: Record<RetentionCategory, EffectiveBoundDef>,
  config: C,
): C {
  const out = { ...config };
  for (const [field, category] of Object.entries(CONFIG_FIELD_TO_CATEGORY)) {
    const value = out[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const clamped = clampToBounds(boundsByCategory[category], value);
    if (clamped !== value) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- field exists on out (just read above)
      (out as Record<string, unknown>)[field] = clamped;
    }
  }
  return out;
}
