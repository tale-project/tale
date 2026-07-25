/**
 * Schema for a skill's `SKILL.md` YAML frontmatter — the on-disk shape of the
 * `skills` org config domain (`<orgSlug>/skills/<slug>/SKILL.md` plus small
 * bundle assets).
 *
 * A skill is a KNOWLEDGE PACK, never something the platform executes: an
 * agent reaches its body and its assets through the `expand_skill` /
 * `read_skill_file` tools. Nothing in this schema describes a runtime, a
 * command, or an entrypoint, and nothing may be added that does.
 *
 * Wire format is the agentskills.io convention — kebab-case keys
 * (`disable-model-invocation`, `recommended-packages`, …) with unknown keys
 * preserved verbatim, so a community bundle authored for another runtime can
 * be dropped into an org tree and read back unchanged. Internal code consumes
 * the camelCase {@link SkillFrontmatter} shape.
 *
 * Two fields are Tale's own and carry the sharing model: `visibility`
 * (`private` — only its owner sees it; `org` — every member does) and
 * `owner`. There is no sharing table anywhere: "share this skill" is an edit
 * that flips `visibility` to `org`.
 *
 * Layer A: imports ONLY `zod/v4` and the shared config helpers — no `node:*`,
 * no `convex/_generated` — so it is safe to import from V8 Convex code,
 * `'use node'` actions, Bun scripts, vitest, and the browser alike.
 */

import { z } from 'zod/v4';

/** Canonical kebab-case shape of a skill slug (its directory name). */
export const SKILL_SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Upper bound on a slug, matching the directory-name budget on disk. */
export const MAX_SKILL_SLUG_LENGTH = 64;

/**
 * Slugs a skill may not claim: an org bundle must not be able to present
 * itself as an upstream-managed one.
 */
export const RESERVED_SKILL_SLUGS: ReadonlySet<string> = new Set([
  'anthropic',
  'claude',
]);

/**
 * Cap on the frontmatter block alone. Generous for metadata, small enough
 * that a runaway document is rejected before the YAML parser walks it.
 */
export const MAX_SKILL_FRONTMATTER_BYTES = 16 * 1024;

/** Cap on a whole `SKILL.md` document (frontmatter + body). */
export const MAX_SKILL_MD_BYTES = 512 * 1024;

/**
 * Caps on a bundle as staged into a sandbox session — SKILL.md plus every
 * asset beside it. Sized for knowledge packs (the largest shipped asset, an
 * OOXML schema, is ~240 KB): a bundle over these is a mis-import, not a
 * bigger skill, and is refused before it is read into memory.
 */
export const MAX_SKILL_BUNDLE_FILES = 512;

/** Cap on one bundle asset file. */
export const MAX_SKILL_BUNDLE_FILE_BYTES = 4 * 1024 * 1024;

/** Cap on a bundle's total bytes across all files. */
export const MAX_SKILL_BUNDLE_TOTAL_BYTES = 32 * 1024 * 1024;

/** How a skill is shared inside its organization. */
export const SKILL_VISIBILITIES = ['private', 'org'] as const;
export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

/**
 * Default when a `SKILL.md` carries no `visibility`. An unmarked bundle was
 * placed in the org's tree deliberately (a community import, a seeded
 * catalog copy), so it belongs to the org; defaulting to `private` would
 * instead make an ownerless file invisible to every member at once.
 */
export const DEFAULT_SKILL_VISIBILITY: SkillVisibility = 'org';

const skillSlugSchema = z
  .string()
  .min(1)
  .max(MAX_SKILL_SLUG_LENGTH)
  .regex(SKILL_SLUG_REGEX, {
    message:
      'name must be lowercase letters, digits and single hyphens (no leading, trailing or repeated hyphens)',
  })
  .refine((slug) => !RESERVED_SKILL_SLUGS.has(slug), {
    message: 'name is reserved and cannot be used by an organization skill',
  });

const PACKAGE_SPEC_MAX = 120;
const PACKAGE_BUCKET_MAX = 20;

/**
 * Raw frontmatter exactly as it appears on disk: kebab-case keys, unknown
 * keys passed through so community extensions survive a round-trip. Exported
 * so the org-config schema snapshot tracks it and a future narrowing is
 * caught as the data-incompatible change it would be.
 */
export const skillFrontmatterSchema = z
  .object({
    name: skillSlugSchema,
    description: z.string().min(1).max(1024),
    /**
     * Who may see this skill inside the org. Absent means
     * {@link DEFAULT_SKILL_VISIBILITY}.
     */
    visibility: z.enum(SKILL_VISIBILITIES).optional(),
    /**
     * The member who owns the bundle, as a user id. Required for a `private`
     * skill (nobody could see an ownerless one); on an `org` skill it is
     * attribution only.
     */
    owner: z.string().min(1).max(128).optional(),
    license: z.string().max(120).optional(),
    /**
     * Package specs the author suggests including in a `run_code` call. Purely
     * advisory — the platform never installs them on a skill's behalf.
     */
    'recommended-packages': z
      .object({
        python: z
          .array(z.string().min(1).max(PACKAGE_SPEC_MAX))
          .max(PACKAGE_BUCKET_MAX)
          .optional(),
        node: z
          .array(z.string().min(1).max(PACKAGE_SPEC_MAX))
          .max(PACKAGE_BUCKET_MAX)
          .optional(),
      })
      .optional(),
    /**
     * When true the model must not reach for this skill on its own; it stays
     * available for an explicit `expand_skill` recall.
     */
    'disable-model-invocation': z.boolean().optional(),
    /** Iconify id (`set:name`) shown on the skill's card. */
    icon: z
      .string()
      .max(128)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*:[a-z0-9]+(-[a-z0-9]+)*$/, {
        message:
          'icon must be an Iconify id like "lucide:book-open" (a "set:name" pair of lowercase letters, digits and hyphens)',
      })
      .optional(),
    /** Display chips shown on the skill's card. */
    labels: z.array(z.string().min(1).max(40)).max(8).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (raw) => raw.visibility !== 'private' || raw.owner !== undefined,
    // A private skill with no owner would be readable by nobody, so it is
    // rejected at the door rather than silently disappearing from listings.
    {
      message: 'owner is required when visibility is "private"',
      path: ['owner'],
    },
  );

type RawSkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

/** Normalized (camelCase) frontmatter consumed by Tale code. */
export interface SkillFrontmatter {
  /** The skill's slug; must equal its directory name. */
  name: string;
  description: string;
  visibility: SkillVisibility;
  owner?: string;
  license?: string;
  recommendedPackages?: {
    python?: string[];
    node?: string[];
  };
  disableModelInvocation?: boolean;
  icon?: string;
  labels?: string[];
  metadata?: Record<string, unknown>;
  /**
   * Frontmatter keys none of the fields above claim, kept verbatim so a
   * community bundle survives an edit-and-save untouched.
   */
  extra: Record<string, unknown>;
}

/** Frontmatter keys the normalized shape owns; everything else is `extra`. */
const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'visibility',
  'owner',
  'license',
  'recommended-packages',
  'disable-model-invocation',
  'icon',
  'labels',
  'metadata',
]);

/** Validate already-parsed frontmatter data into the normalized shape. */
export function validateSkillFrontmatter(data: unknown):
  | {
      readonly ok: true;
      readonly meta: SkillFrontmatter;
    }
  | {
      readonly ok: false;
      readonly error: z.ZodError;
    } {
  const result = skillFrontmatterSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error };
  }
  return { ok: true, meta: normalizeFrontmatter(result.data) };
}

function normalizeFrontmatter(raw: RawSkillFrontmatter): SkillFrontmatter {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      extra[key] = value;
    }
  }
  const meta: SkillFrontmatter = {
    name: raw.name,
    description: raw.description,
    visibility: raw.visibility ?? DEFAULT_SKILL_VISIBILITY,
    extra,
  };
  if (raw.owner !== undefined) meta.owner = raw.owner;
  if (raw.license !== undefined) meta.license = raw.license;
  if (raw['recommended-packages'] !== undefined) {
    meta.recommendedPackages = raw['recommended-packages'];
  }
  if (raw['disable-model-invocation'] !== undefined) {
    meta.disableModelInvocation = raw['disable-model-invocation'];
  }
  if (raw.icon !== undefined) meta.icon = raw.icon;
  if (raw.labels !== undefined) meta.labels = raw.labels;
  if (raw.metadata !== undefined) meta.metadata = raw.metadata;
  return meta;
}

/**
 * Turn normalized frontmatter back into the kebab-case on-disk mapping.
 * Key order is stable so an unchanged skill re-serializes byte-identically,
 * and unknown keys are appended without overwriting a known one.
 */
export function skillFrontmatterToRaw(
  meta: SkillFrontmatter,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    name: meta.name,
    description: meta.description,
    visibility: meta.visibility,
  };
  if (meta.owner !== undefined) raw.owner = meta.owner;
  if (meta.license !== undefined) raw.license = meta.license;
  if (meta.recommendedPackages !== undefined) {
    raw['recommended-packages'] = meta.recommendedPackages;
  }
  if (meta.disableModelInvocation !== undefined) {
    raw['disable-model-invocation'] = meta.disableModelInvocation;
  }
  if (meta.icon !== undefined) raw.icon = meta.icon;
  if (meta.labels !== undefined) raw.labels = meta.labels;
  if (meta.metadata !== undefined) raw.metadata = meta.metadata;
  for (const [key, value] of Object.entries(meta.extra)) {
    if (!(key in raw)) raw[key] = value;
  }
  return raw;
}

/** True when `slug` is a usable skill directory name. */
export function isValidSkillSlug(slug: string): boolean {
  return skillSlugSchema.safeParse(slug).success;
}
