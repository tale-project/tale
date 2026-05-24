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

const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_NAMES = new Set(['anthropic', 'claude']);

const LOCALE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;
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
      .refine((s) => !RESERVED_NAMES.has(s), {
        message: 'name cannot be a reserved word ("anthropic" or "claude")',
      }),
    description: z.string().min(1).max(1024),
    'tool-names': z.array(z.string().max(120)).max(64).optional(),
    'integration-bindings': z.array(z.string().max(64)).max(32).optional(),
    'workflow-bindings': z.array(z.string().max(64)).max(32).optional(),
    packages: z
      .object({
        python: z
          .array(z.string().max(PACKAGE_SPEC_MAX))
          .max(PACKAGE_BUCKET_MAX)
          .optional(),
        node: z
          .array(z.string().max(PACKAGE_SPEC_MAX))
          .max(PACKAGE_BUCKET_MAX)
          .optional(),
      })
      .optional(),
    'role-restriction': z.literal('admin_developer').optional(),
    'shared-with-team-ids': z.array(z.string().max(80)).max(20).optional(),
    license: z.string().max(120).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    i18n: z
      .record(
        z.string().regex(LOCALE_REGEX),
        z.object({
          description: z.string().min(1).max(1024).optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export type RawSkillFrontmatter = z.infer<typeof rawFrontmatterSchema>;

/** Normalized (camelCase) frontmatter consumed by Tale runtime/UI code. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  toolNames?: string[];
  integrationBindings?: string[];
  workflowBindings?: string[];
  packages?: {
    python?: string[];
    node?: string[];
  };
  roleRestriction?: 'admin_developer';
  sharedWithTeamIds?: string[];
  license?: string;
  metadata?: Record<string, unknown>;
  i18n?: Record<string, { description?: string }>;
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
  'tool-names',
  'integration-bindings',
  'workflow-bindings',
  'packages',
  'role-restriction',
  'shared-with-team-ids',
  'license',
  'metadata',
  'i18n',
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
  if (raw['tool-names'] !== undefined) out.toolNames = raw['tool-names'];
  if (raw['integration-bindings'] !== undefined) {
    out.integrationBindings = raw['integration-bindings'];
  }
  if (raw['workflow-bindings'] !== undefined) {
    out.workflowBindings = raw['workflow-bindings'];
  }
  if (raw.packages !== undefined) out.packages = raw.packages;
  if (raw['role-restriction'] !== undefined) {
    out.roleRestriction = raw['role-restriction'];
  }
  if (raw['shared-with-team-ids'] !== undefined) {
    out.sharedWithTeamIds = raw['shared-with-team-ids'];
  }
  if (raw.license !== undefined) out.license = raw.license;
  if (raw.metadata !== undefined) out.metadata = raw.metadata;
  if (raw.i18n !== undefined) out.i18n = raw.i18n;
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
  if (meta.toolNames !== undefined) raw['tool-names'] = meta.toolNames;
  if (meta.integrationBindings !== undefined) {
    raw['integration-bindings'] = meta.integrationBindings;
  }
  if (meta.workflowBindings !== undefined) {
    raw['workflow-bindings'] = meta.workflowBindings;
  }
  if (meta.packages !== undefined) raw.packages = meta.packages;
  if (meta.roleRestriction !== undefined) {
    raw['role-restriction'] = meta.roleRestriction;
  }
  if (meta.sharedWithTeamIds !== undefined) {
    raw['shared-with-team-ids'] = meta.sharedWithTeamIds;
  }
  if (meta.license !== undefined) raw.license = meta.license;
  if (meta.metadata !== undefined) raw.metadata = meta.metadata;
  if (meta.i18n !== undefined) raw.i18n = meta.i18n;
  for (const [k, v] of Object.entries(meta.unknown)) {
    if (!(k in raw)) raw[k] = v;
  }
  return raw;
}

/** Reserved tool names skills cannot declare (collide with built-ins). */
export const SKILL_RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'expand_skill',
  'read_skill_file',
  'skill_run',
]);

export { rawFrontmatterSchema };
