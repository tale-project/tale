/**
 * Single source of truth for retention min/max bounds per category.
 *
 * Bounds layer in two tiers:
 *   1. **Code-hardcoded** in `RETENTION_DEFAULTS` below — the platform's
 *      absolute floors and ceilings. The audit-log min of 365d cannot be
 *      relaxed even by the operator (PCI/SOC2 baseline).
 *   2. **Env-var operator overrides** via `TALE_RETENTION_<CAT>_MIN_DAYS`
 *      and `TALE_RETENTION_<CAT>_MAX_DAYS` — operators can only TIGHTEN
 *      the defaults (raise min, lower max), never relax.
 *
 * Combined effective bound:
 *   - effective_min = max(code_min, env_min ?? 0)
 *   - effective_max = min(code_max, env_max ?? Infinity)
 *
 * Org-level retention policy values (set via the governance editor) must
 * land inside `[effective_min, effective_max]`. `governance/mutations.ts`
 * `upsertPolicy` rejects out-of-bounds values with `RETENTION_BELOW_FLOOR`
 * or `RETENTION_EXCEEDS_CEILING`. The cleanup runner additionally clamps
 * at runtime so previously-stored values that were valid under an older
 * env config can't bypass a newly-tightened ceiling.
 *
 * `TALE_RETENTION_DISABLED=true` short-circuits the cleanup action with
 * a single warn-log (operator kill-switch for migration windows / debug).
 *
 * NOTE: Convex caches env at process start. Operators changing env vars
 * must restart the Convex backend container for the new bounds to take
 * effect; see docs/self-hosted/configuration/retention.md.
 */

export type RetentionCategory =
  | 'documents'
  | 'userTempHours'
  | 'agentTempHours'
  | 'chatHistory'
  | 'auditLog'
  | 'workflowLog'
  | 'usageLedger'
  | 'loginAttempt'
  | 'chatFilterEvents'
  | 'promptTemplates'
  | 'messageFeedback'
  | 'memoryAudit'
  | 'customers'
  | 'vendors'
  | 'externalConversations'
  | 'messageMetadata';

interface BoundDef {
  min: number;
  max: number;
  default: number;
  /**
   * Env var prefix (without _MIN_DAYS / _MAX_DAYS suffix). e.g.
   * `TALE_RETENTION_AUDIT` → reads `TALE_RETENTION_AUDIT_MIN_DAYS` and
   * `TALE_RETENTION_AUDIT_MAX_DAYS`. For temp-hour categories the suffix
   * is `_MIN_HOURS` / `_MAX_HOURS`.
   */
  envPrefix: string;
  unit: 'days' | 'hours';
}

/**
 * Hardcoded baseline. Operators TIGHTEN these via env vars; they cannot
 * relax. Audit/login mins are baselines from PCI/SOC2/ISO27001.
 */
export const RETENTION_DEFAULTS: Record<RetentionCategory, BoundDef> = {
  documents: {
    min: 30,
    max: 3650,
    default: 365,
    envPrefix: 'TALE_RETENTION_FILES',
    unit: 'days',
  },
  userTempHours: {
    min: 1,
    max: 720,
    default: 24,
    envPrefix: 'TALE_RETENTION_USER_TEMP',
    unit: 'hours',
  },
  agentTempHours: {
    min: 1,
    max: 720,
    default: 24,
    envPrefix: 'TALE_RETENTION_AGENT_TEMP',
    unit: 'hours',
  },
  chatHistory: {
    min: 1,
    max: 3650,
    default: 90,
    envPrefix: 'TALE_RETENTION_CONVERSATIONS',
    unit: 'days',
  },
  auditLog: {
    min: 365,
    max: 3650,
    default: 730,
    envPrefix: 'TALE_RETENTION_AUDIT',
    unit: 'days',
  },
  workflowLog: {
    min: 1,
    max: 365,
    default: 30,
    envPrefix: 'TALE_RETENTION_EXECUTIONS',
    unit: 'days',
  },
  usageLedger: {
    min: 30,
    max: 3650,
    default: 365,
    envPrefix: 'TALE_RETENTION_ANALYTICS',
    unit: 'days',
  },
  loginAttempt: {
    min: 90,
    max: 365,
    default: 90,
    envPrefix: 'TALE_RETENTION_LOGIN_ATTEMPTS',
    unit: 'days',
  },
  chatFilterEvents: {
    min: 1,
    max: 365,
    default: 90,
    envPrefix: 'TALE_RETENTION_CHAT_FILTER_EVENTS',
    unit: 'days',
  },
  promptTemplates: {
    min: 30,
    max: 3650,
    default: 730,
    envPrefix: 'TALE_RETENTION_PROMPT_TEMPLATES',
    unit: 'days',
  },
  messageFeedback: {
    min: 30,
    max: 3650,
    default: 365,
    envPrefix: 'TALE_RETENTION_MESSAGE_FEEDBACK',
    unit: 'days',
  },
  memoryAudit: {
    min: 30,
    max: 3650,
    default: 365,
    envPrefix: 'TALE_RETENTION_MEMORY_AUDIT',
    unit: 'days',
  },
  customers: {
    min: 30,
    max: 3650,
    default: 730,
    envPrefix: 'TALE_RETENTION_CUSTOMERS',
    unit: 'days',
  },
  vendors: {
    min: 30,
    max: 3650,
    default: 730,
    envPrefix: 'TALE_RETENTION_VENDORS',
    unit: 'days',
  },
  externalConversations: {
    min: 30,
    max: 3650,
    default: 730,
    envPrefix: 'TALE_RETENTION_EXTERNAL_CONVERSATIONS',
    unit: 'days',
  },
  messageMetadata: {
    min: 30,
    max: 3650,
    default: 365,
    envPrefix: 'TALE_RETENTION_MESSAGE_METADATA',
    unit: 'days',
  },
};

export interface EffectiveBounds {
  category: RetentionCategory;
  min: number;
  max: number;
  default: number;
  unit: 'days' | 'hours';
  source: 'code' | 'env';
}

function parseEnvNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Read effective `{ min, max }` for one category from defaults + env. */
export function getRetentionBounds(
  category: RetentionCategory,
): EffectiveBounds {
  const def = RETENTION_DEFAULTS[category];
  const suffix = def.unit === 'hours' ? 'HOURS' : 'DAYS';
  const envMin = parseEnvNumber(`${def.envPrefix}_MIN_${suffix}`);
  const envMax = parseEnvNumber(`${def.envPrefix}_MAX_${suffix}`);

  const min = Math.max(def.min, envMin ?? 0);
  const max = Math.min(def.max, envMax ?? Number.POSITIVE_INFINITY);
  return {
    category,
    min,
    max: Number.isFinite(max) ? max : def.max,
    default: def.default,
    unit: def.unit,
    source: envMin !== null || envMax !== null ? 'env' : 'code',
  };
}

/** Snapshot of every category's effective bounds. */
export function getAllRetentionBounds(): EffectiveBounds[] {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys widens to string[] but RETENTION_DEFAULTS keys are exhaustively RetentionCategory
  const categories = Object.keys(RETENTION_DEFAULTS) as RetentionCategory[];
  return categories.map(getRetentionBounds);
}

/**
 * `TALE_RETENTION_DISABLED=true` short-circuits the cleanup action with
 * a single warn-log. Used during migration windows or for emergency
 * "freeze all auto-deletion this week" scenarios.
 */
export function isRetentionDisabled(): boolean {
  return process.env.TALE_RETENTION_DISABLED === 'true';
}

/**
 * Throws if `value` is outside `[min, max]`. Caller catches and converts
 * to a `ConvexError` with the specific code.
 */
export function assertWithinBounds(
  category: RetentionCategory,
  value: number,
): void {
  const bounds = getRetentionBounds(category);
  if (value < bounds.min) {
    throw new RetentionBoundsViolation('RETENTION_BELOW_FLOOR', {
      category,
      requested: value,
      bound: bounds.min,
      source: bounds.source,
    });
  }
  if (value > bounds.max) {
    throw new RetentionBoundsViolation('RETENTION_EXCEEDS_CEILING', {
      category,
      requested: value,
      bound: bounds.max,
      source: bounds.source,
    });
  }
}

export class RetentionBoundsViolation extends Error {
  readonly code: 'RETENTION_BELOW_FLOOR' | 'RETENTION_EXCEEDS_CEILING';
  readonly category: RetentionCategory;
  readonly requested: number;
  readonly bound: number;
  readonly source: 'code' | 'env';

  constructor(
    code: 'RETENTION_BELOW_FLOOR' | 'RETENTION_EXCEEDS_CEILING',
    detail: {
      category: RetentionCategory;
      requested: number;
      bound: number;
      source: 'code' | 'env';
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

/**
 * Clamp a stored config value to current bounds at cleanup time. Used as
 * defense-in-depth against rows persisted before a tightening env change.
 */
export function clampToBounds(
  category: RetentionCategory,
  value: number,
): number {
  const bounds = getRetentionBounds(category);
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return value;
}
