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
 * Per-category `_metadata` block. Holds display-overrides only.
 * Env binding (`envPrefix` / `envNames`) lives at the root level —
 * `.strict()` rejects them here.
 */
export const retentionCategoryMetadataSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    help: z.string().max(2000).optional(),
    order: z.number().int().optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export type RetentionCategoryMetadata = z.infer<
  typeof retentionCategoryMetadataSchema
>;

/**
 * Per-category bounds shape stored in the JSON file. Holds `min` /
 * `max` / `default` plus the display `unit` and optional display
 * `_metadata`. Env binding is NOT here — it's at the root level.
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
    _metadata: retentionCategoryMetadataSchema.optional(),
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
  );

export type RetentionDefaultsConfig = z.infer<
  typeof retentionDefaultsConfigSchema
>;
