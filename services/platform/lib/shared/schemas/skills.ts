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

const PACKAGE_SPEC_MAX = 120;
const PACKAGE_BUCKET_MAX = 20;

/**
 * Reserved tool names skills cannot declare. Only the three built-ins
 * that the runtime actually splices into every effective tool set are
 * listed — `skill_run_script` / `skill_run_pipeline` were reserved
 * speculatively for a never-shipped multi-step skill executor; keeping
 * them in the reject set would block skill authors from naming
 * unrelated tools that happen to share the prefix, with no real
 * collision risk to defend against.
 */
export const SKILL_RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'expand_skill',
  'read_skill_file',
  'skill_run',
]);

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
    'tool-names': z
      .array(
        z
          .string()
          .min(1)
          .max(120)
          .refine((s) => !SKILL_RESERVED_TOOL_NAMES.has(s), {
            message:
              'tool-names cannot shadow a built-in skill tool (expand_skill, read_skill_file, skill_run, skill_run_script, skill_run_pipeline)',
          }),
      )
      .max(64)
      .optional(),
    'integration-bindings': z
      .array(z.string().min(1).max(64))
      .max(32)
      .optional(),
    'workflow-bindings': z.array(z.string().min(1).max(64)).max(32).optional(),
    packages: z
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
  'tool-names',
  'integration-bindings',
  'workflow-bindings',
  'packages',
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
  if (raw['tool-names'] !== undefined) out.toolNames = raw['tool-names'];
  if (raw['integration-bindings'] !== undefined) {
    out.integrationBindings = raw['integration-bindings'];
  }
  if (raw['workflow-bindings'] !== undefined) {
    out.workflowBindings = raw['workflow-bindings'];
  }
  if (raw.packages !== undefined) out.packages = raw.packages;
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
  if (meta.toolNames !== undefined) raw['tool-names'] = meta.toolNames;
  if (meta.integrationBindings !== undefined) {
    raw['integration-bindings'] = meta.integrationBindings;
  }
  if (meta.workflowBindings !== undefined) {
    raw['workflow-bindings'] = meta.workflowBindings;
  }
  if (meta.packages !== undefined) raw.packages = meta.packages;
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

export { rawFrontmatterSchema };
