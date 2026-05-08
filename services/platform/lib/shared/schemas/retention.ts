import { z } from 'zod/v4';

/**
 * Canonical 16-category list. Source of truth for retention category
 * identifiers. Both `retention_floors.ts` (structural metadata + env
 * resolver) and the JSON config schema below import from here.
 */
export const RETENTION_CATEGORIES = [
  'documents',
  'userTempHours',
  'agentTempHours',
  'chatHistory',
  'auditLog',
  'workflowLog',
  'usageLedger',
  'loginAttempt',
  'chatFilterEvents',
  'promptTemplates',
  'messageFeedback',
  'memoryAudit',
  'customers',
  'vendors',
  'externalConversations',
  'messageMetadata',
] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export const retentionCategoryEnum = z.enum(RETENTION_CATEGORIES);

const RETENTION_BOUND_FIELDS = ['min', 'max', 'default'] as const;
export type RetentionBoundField = (typeof RETENTION_BOUND_FIELDS)[number];

const ENV_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;
const PATH_REGEX = /^[a-zA-Z][a-zA-Z0-9]*\.(min|max|default)$/;
const VALID_BOUND_PATHS = new Set(
  RETENTION_CATEGORIES.flatMap((cat) =>
    RETENTION_BOUND_FIELDS.map((f) => `${cat}.${f}`),
  ),
);

/**
 * Root-level `_metadata` block. ONLY allowed at the file root.
 * Per-category `_metadata` uses `retentionCategoryMetadataSchema` and
 * forbids `envPrefix` / `envNames` (env binding lives at root only).
 *
 * - `envPrefix` (optional): common prefix for every env name. Used as
 *   plain string concatenation: `${envPrefix}${suffix}` → full env
 *   name. Operator can include trailing separator (e.g. `_`) directly
 *   in the prefix value. `TALE_RETENTION_` + `AUDIT_MIN` →
 *   `TALE_RETENTION_AUDIT_MIN`.
 * - `envNames` (optional): map from suffix → JSON object path. Each
 *   entry says "this env variable controls this field." Operator
 *   reads the file and sees at a glance which env affects which
 *   field. No derivation, no rules — explicit 1:1 mapping.
 *
 * Path values must match `${RetentionCategory}.${'min'|'max'|'default'}`.
 * Combined `envPrefix.length + suffix.length` must be ≤ 40 (Convex
 * env-name cap).
 */
export const retentionRootMetadataSchema = z
  .object({
    envPrefix: z.string().regex(ENV_NAME_REGEX).max(30).optional(),
    envNames: z
      .record(
        z.string().regex(ENV_NAME_REGEX).max(40),
        z.string().regex(PATH_REGEX),
      )
      .optional(),
  })
  .strict()
  .refine(
    (v) => {
      if (!v.envPrefix || !v.envNames) return true;
      return Object.keys(v.envNames).every(
        (suf) => v.envPrefix!.length + suf.length <= 40,
      );
    },
    {
      message: 'envPrefix + suffix must be ≤ 40 chars (Convex env-name limit)',
    },
  )
  .refine(
    (v) => {
      if (!v.envNames) return true;
      return Object.values(v.envNames).every((path) =>
        VALID_BOUND_PATHS.has(path),
      );
    },
    {
      message:
        'envNames path must be `${category}.${min|max|default}` for a known retention category',
    },
  );

export type RetentionRootMetadata = z.infer<typeof retentionRootMetadataSchema>;

/**
 * Per-category bounds shape stored in the JSON file. Holds `min` /
 * `max` / `default` plus the display `unit`. Env binding lives at the
 * root level (`_metadata.envNames`); per-category UI metadata
 * (label/help/order/hidden/configKey/...) lives in the TS descriptor
 * (`WIRE_MAPPING` in the FE editor) — JSON is for instance values
 * only.
 *
 * `unit` is a structural fact (tied to the policy field name —
 * `<name>RetentionDays` vs `<name>RetentionHours`), but lives in the
 * JSON as the single source of truth for display. The parent-level
 * `retentionDefaultsConfigSchema` refines it to match the category id
 * naming convention so an operator cannot create a display/storage
 * mismatch by editing the file.
 */
export const retentionBoundDefSchema = z
  .object({
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    default: z.number().int().nonnegative(),
    unit: z.enum(['days', 'hours']),
  })
  .strict()
  .refine((v) => v.min <= v.default && v.default <= v.max, {
    message: 'min ≤ default ≤ max required',
  });

export type RetentionBoundDef = z.infer<typeof retentionBoundDefSchema>;

/**
 * Returns the structurally-correct `unit` for a category id. Categories
 * named `<name>Hours` (e.g. `userTempHours`) measure in hours; all
 * others measure in days. Used by both the schema refine and the
 * frontend's loading-state fallback so the convention is encoded once.
 */
export function unitForCategory(cat: RetentionCategory): 'days' | 'hours' {
  return cat.endsWith('Hours') ? 'hours' : 'days';
}

/**
 * Per-org JSON file shape: optional root `_metadata` (env binding
 * config) plus a subset of `RETENTION_CATEGORIES`, each mapped to
 * `retentionBoundDefSchema`.
 *
 * Built explicitly via `z.object({...}).strict()` so:
 *   - unknown keys are rejected (typos surface early)
 *   - partial files are supported (operators only declare the
 *     categories they want to customize, others fall back to the
 *     default org's file at the V8 action layer)
 */
type RetentionConfigShape = {
  [K in RetentionCategory]: z.ZodOptional<typeof retentionBoundDefSchema>;
} & { _metadata: z.ZodOptional<typeof retentionRootMetadataSchema> };

const retentionConfigShape: RetentionConfigShape = {
  ...(Object.fromEntries(
    RETENTION_CATEGORIES.map(
      (cat) => [cat, retentionBoundDefSchema.optional()] as const,
    ),
  ) as unknown as {
    [K in RetentionCategory]: z.ZodOptional<typeof retentionBoundDefSchema>;
  }),
  _metadata: retentionRootMetadataSchema.optional(),
};

/**
 * Compliance-floor map: per-category MIN values that the operator's
 * file CANNOT undercut. The schema validates this at file-parse time
 * so a hand-edited JSON cannot silently drop the audit-log retention
 * below the PCI/SOC2/ISO baseline (round-2 v18 / A31 M3).
 *
 * Categories not listed here have no compliance-mandated floor — the
 * file's `min: 0` lower bound applies as before.
 */
export const RETENTION_COMPLIANCE_FLOORS: Partial<
  Record<RetentionCategory, number>
> = {
  // PCI-DSS 10.5.3, SOC 2 CC7.3, ISO 27001 A.12.4 — audit logs retained
  // at least one year. Baseline floor; ops can RAISE via env or file.
  auditLog: 365,
  // NIST SP 800-92 §4.3 — retain login attempts long enough to detect
  // slow-and-low brute force across calendar quarters.
  loginAttempt: 90,
};

export const retentionDefaultsConfigSchema = z
  .object(retentionConfigShape)
  .strict()
  .refine(
    (v) =>
      // At least one category must be present. Root `_metadata` alone
      // (without any category) is rejected — file would be useless.
      Object.keys(v).some((k) => k !== '_metadata'),
    { message: 'retention config must define at least one category' },
  )
  .refine(
    (v) => {
      // Every declared category must declare `unit` matching its id
      // suffix (`*Hours` → 'hours', else 'days'). This pins down a
      // display/storage contract: cleanup math reads the policy field
      // by name (`<name>RetentionDays` vs `<name>RetentionHours`), so
      // a JSON `unit` that disagreed with the id suffix would let the
      // editor render hours while cleanup ran days — silent corruption.
      for (const cat of RETENTION_CATEGORIES) {
        const bound = (v as Record<string, RetentionBoundDef | undefined>)[cat];
        if (!bound) continue;
        if (bound.unit !== unitForCategory(cat)) return false;
      }
      return true;
    },
    {
      message:
        'each category `unit` must match its id (categories ending in "Hours" are "hours", others are "days")',
    },
  )
  .refine(
    (v) => {
      for (const [cat, floor] of Object.entries(RETENTION_COMPLIANCE_FLOORS)) {
        const bound = (v as Record<string, RetentionBoundDef | undefined>)[cat];
        if (!bound) continue;
        if (bound.min < floor) return false;
      }
      return true;
    },
    {
      message:
        'compliance floor violation: see RETENTION_COMPLIANCE_FLOORS for hard minimums (e.g. auditLog.min >= 365 per PCI/SOC2/ISO baseline)',
    },
  );

export type RetentionDefaultsConfig = z.infer<
  typeof retentionDefaultsConfigSchema
>;

/**
 * Per-category effective bounds stored in `retentionAppliedBounds`. Only
 * the two fields cleanup actually consumes (`min`, `max`) — display
 * metadata, env-binding detail, and the `default` seed live in the file
 * and are recomputed on each banner render.
 */
export interface AppliedBoundsByCategory {
  // oxlint-disable-next-line typescript/consistent-indexed-object-style -- partial set of categories per org
  [category: string]: { min: number; max: number };
}

/**
 * Deterministic JSON of `bounds` with category keys sorted and per-bound
 * field keys sorted (`max`, `min`). Identical content always serializes
 * to the same string regardless of insertion order — feeds the SHA-256
 * hash that detects file/env changes.
 *
 * Pure, sync, no zod — usable from V8 actions, Node actions, frontend.
 */
export function canonicalizeAppliedBounds(
  bounds: AppliedBoundsByCategory,
): string {
  const cats = Object.keys(bounds).sort();
  const entries = cats.map((cat) => {
    const b = bounds[cat];
    if (!b) return JSON.stringify(cat) + ':null';
    // Two-field fixed shape; sort once for stability.
    const inner = `{"max":${b.max},"min":${b.min}}`;
    return JSON.stringify(cat) + ':' + inner;
  });
  return '{' + entries.join(',') + '}';
}

/**
 * SHA-256 hex of `canonicalizeAppliedBounds(bounds)`. Async because
 * `crypto.subtle.digest` is async; works in V8 (Convex), Node 20+,
 * and browsers (banner can recompute client-side if needed).
 */
export async function hashAppliedBounds(
  bounds: AppliedBoundsByCategory,
): Promise<string> {
  const canonical = canonicalizeAppliedBounds(bounds);
  const data = new TextEncoder().encode(canonical);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
