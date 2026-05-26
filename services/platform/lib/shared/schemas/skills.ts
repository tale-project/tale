import { parseDocument } from 'yaml';
import { z } from 'zod/v4';

/**
 * Schema for a Skill's `SKILL.md` YAML frontmatter, aligned with the
 * agentskills.io open standard so community skills authored for
 * Anthropic / OpenAI / LangChain runtimes can be copied into Tale verbatim.
 *
 * Wire format (on disk in `SKILL.md`): kebab-case keys
 * (`tool-names`, `integration-bindings`, `role-restriction`, ...) — matches
 * Claude Code / agentskills.io convention. Internal code consumes the
 * camelCase shape produced by {@link parseSkillMd}.
 *
 * Unknown keys are preserved via {@link rawFrontmatterSchema}'s passthrough
 * so community fields like `allowed-tools`, `when-to-use`,
 * `disable-model-invocation` round-trip without rejection.
 */

/**
 * Canonical kebab-case validator for skill slugs. Exported so the runtime,
 * frontend dialogs, and the agents-side binding schema all gate on the
 * same shape — previously each file inlined the literal and the copies
 * had begun to diverge in minor ways (case sensitivity, leading-digit
 * rules).
 */
export const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/**
 * Slugs reserved by the SKILL.md frontmatter schema. Anthropic / Claude
 * are reserved so a platform skill cannot impersonate an upstream-managed
 * bundle (the runtime's manifest fetcher uses these as identity markers
 * elsewhere). Exported so `convex/skills/file_utils.ts` shares the same
 * source of truth instead of carrying an apologetic local copy.
 */
export const RESERVED_SKILL_NAMES: ReadonlySet<string> = new Set([
  'anthropic',
  'claude',
]);

/**
 * Per-file cap inside a skill bundle. Tuned so a typical reference PDF or
 * script fits but a single file can't be used to push a multi-megabyte blob
 * through the upload path. Enforced on both client (pre-flight) and server
 * (authoritative).
 */
export const MAX_SKILL_BUNDLE_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Total decompressed bundle cap. Defends against zip-bombs and accidental
 * mass uploads.
 */
export const MAX_SKILL_BUNDLE_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Maximum number of entries (files + dirs) we'll process from a single
 * uploaded zip. Independent of byte caps — protects against pathological
 * archives full of empty entries.
 */
export const MAX_SKILL_BUNDLE_ENTRIES = 200;

const PACKAGE_SPEC_MAX = 120;
const PACKAGE_BUCKET_MAX = 20;

/** Raw frontmatter as it appears on disk (kebab-case keys, passthrough). */
const rawFrontmatterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(SKILL_NAME_REGEX, {
        message:
          'name must be lowercase letters/numbers/hyphens only, no leading/trailing/consecutive hyphens',
      })
      .refine((s) => !RESERVED_SKILL_NAMES.has(s), {
        message: 'name cannot be a reserved word ("anthropic" or "claude")',
      }),
    description: z.string().min(1).max(1024),
    /**
     * Advisory `recommendedPackages` (on-disk: `recommended-packages`) —
     * package specs the SKILL.md author suggests the model includes when
     * calling `run_code`. NOT enforced or auto-installed; org-level
     * `orgPackagePolicy` is the only gating mechanism. Skill UI may
     * surface this as a hint.
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
    license: z.string().max(120).optional(),
    /**
     * Canonical agentskills.io field — when `true`, the model must NOT
     * auto-invoke this skill from the "Available Skills" prompt; the user
     * (or a wrapping flow) explicitly opts in. Honored at runtime by
     * suppressing the skill from `buildAvailableSkillsSection` while
     * keeping it available to `expand_skill` for explicit recall.
     */
    'disable-model-invocation': z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

type RawSkillFrontmatter = z.infer<typeof rawFrontmatterSchema>;

/** Normalized (camelCase) frontmatter consumed by Tale runtime/UI code. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  /**
   * Advisory list of pip / npm specs the skill author recommends including
   * in a `run_code({packages})` call. The platform never auto-installs
   * these — they're surfaced to the model via the SKILL.md text and to the
   * UI as a hint. The org-level `orgPackagePolicy` is the only gating
   * mechanism.
   */
  recommendedPackages?: {
    python?: string[];
    node?: string[];
  };
  license?: string;
  /**
   * Canonical agentskills.io extension — when true, the runtime omits
   * this skill from the "Available Skills" system-prompt section so the
   * model won't auto-invoke it. The skill is still callable via
   * `expand_skill` for explicit/UX-driven recall.
   */
  disableModelInvocation?: boolean;
  metadata?: Record<string, unknown>;
  /**
   * Verbatim copy of frontmatter keys not covered by the known fields above.
   * Preserves community extensions (`allowed-tools`, `when-to-use`, etc.)
   * for round-trip and future use without rejecting the skill.
   */
  unknown: Record<string, unknown>;
}

const KNOWN_KEBAB_KEYS = new Set<string>([
  'name',
  'description',
  'recommended-packages',
  'license',
  'disable-model-invocation',
  'metadata',
]);

function normalize(raw: RawSkillFrontmatter): SkillFrontmatter {
  const unknown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_KEBAB_KEYS.has(k)) {
      unknown[k] = v;
    }
  }
  const out: SkillFrontmatter = {
    name: raw.name,
    description: raw.description,
    unknown,
  };
  if (raw['recommended-packages'] !== undefined) {
    out.recommendedPackages = raw['recommended-packages'];
  }
  if (raw.license !== undefined) out.license = raw.license;
  if (raw['disable-model-invocation'] !== undefined) {
    out.disableModelInvocation = raw['disable-model-invocation'];
  }
  if (raw.metadata !== undefined) out.metadata = raw.metadata;
  return out;
}

const FRONTMATTER_FENCE = /^---\s*\r?\n/;
const MAX_FRONTMATTER_BYTES = 16 * 1024;

/**
 * Structured error raised by {@link parseSkillMd}. Convex layer maps this to
 * `ConvexError('invalid_frontmatter', { line, message })`.
 */
export class SkillFrontmatterError extends Error {
  readonly line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'SkillFrontmatterError';
    this.line = line;
  }
}

/**
 * Parse a `SKILL.md` document into validated frontmatter + raw markdown body.
 *
 * Security: YAML 1.2 core schema only (no `!!js/*` constructors), capped
 * alias expansion, 16 KB frontmatter pre-check. Throws
 * {@link SkillFrontmatterError} for any malformed input.
 */
export function parseSkillMd(content: string): {
  meta: SkillFrontmatter;
  body: string;
} {
  const match = FRONTMATTER_FENCE.exec(content);
  if (!match || match.index !== 0) {
    throw new SkillFrontmatterError(
      'SKILL.md must begin with YAML frontmatter delimited by `---` lines',
      1,
    );
  }

  const after = content.slice(match[0].length);
  const closeMatch = /\r?\n---\s*(\r?\n|$)/.exec(after);
  if (!closeMatch) {
    throw new SkillFrontmatterError(
      'YAML frontmatter is not closed by a `---` line',
    );
  }

  const fmText = after.slice(0, closeMatch.index);
  if (Buffer.byteLength(fmText, 'utf-8') > MAX_FRONTMATTER_BYTES) {
    throw new SkillFrontmatterError(
      `Frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYamlSafely(fmText);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SkillFrontmatterError(`YAML parse error: ${msg}`);
  }

  if (parsed === null || parsed === undefined) {
    throw new SkillFrontmatterError('Frontmatter is empty');
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SkillFrontmatterError('Frontmatter must be a YAML mapping');
  }

  const result = rawFrontmatterSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const pathStr =
      first && first.path.length > 0 ? first.path.join('.') : '(root)';
    throw new SkillFrontmatterError(
      `Invalid frontmatter at ${pathStr}: ${first?.message ?? 'validation failed'}`,
    );
  }

  const meta = normalize(result.data);
  const body = after.slice(closeMatch.index + closeMatch[0].length);
  return { meta, body };
}

/**
 * Parse YAML using the strict 1.2 core schema (no JS-Yaml-style custom tags,
 * no `!!timestamp` coercion) with a bounded alias-expansion budget to defeat
 * billion-laughs anchor bombs. `maxAliasCount` belongs on `toJS()`'s
 * materialization step — that's where alias expansion is enforced in
 * `yaml@2.x`.
 */
function parseYamlSafely(text: string): unknown {
  const doc = parseDocument(text, { schema: 'core' });
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0].message);
  }
  return doc.toJS({ maxAliasCount: 50 });
}

/**
 * Serialize a normalized frontmatter back into the on-disk kebab-case shape
 * (just the frontmatter object — not the `---` fences). Used by writers
 * when round-tripping unknown community fields.
 */
export function frontmatterToRaw(
  meta: SkillFrontmatter,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    name: meta.name,
    description: meta.description,
  };
  if (meta.recommendedPackages !== undefined) {
    raw['recommended-packages'] = meta.recommendedPackages;
  }
  if (meta.license !== undefined) raw.license = meta.license;
  if (meta.disableModelInvocation !== undefined) {
    raw['disable-model-invocation'] = meta.disableModelInvocation;
  }
  if (meta.metadata !== undefined) raw.metadata = meta.metadata;
  for (const [k, v] of Object.entries(meta.unknown)) {
    if (!(k in raw)) raw[k] = v;
  }
  return raw;
}
