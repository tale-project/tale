/**
 * `SKILL.md` ⇄ frontmatter + body.
 *
 * The document is a YAML mapping fenced by `---` lines followed by markdown.
 * Parsing goes through the shared safe YAML loader (core schema only, bounded
 * alias expansion, size cap) and then the shared frontmatter schema, so a
 * skill file is held to exactly the same parsing rules as every other org
 * config file.
 *
 * Every failure carries the file's path. A skill that cannot be read is a
 * misconfiguration an operator has to see, not a bundle to quietly skip: the
 * thrown error names the path, the line where one is available, and the
 * offending field.
 *
 * Pure: no filesystem, no Convex. Callers hand in text they read themselves.
 */

import { parseYaml, stringifyYaml } from '../shared/config/yaml';
import { formatZodError } from '../shared/schemas/format-error';
import {
  MAX_SKILL_FRONTMATTER_BYTES,
  MAX_SKILL_MD_BYTES,
  skillFrontmatterToRaw,
  validateSkillFrontmatter,
  type SkillFrontmatter,
} from '../shared/schemas/skills';

/** A `SKILL.md` that could not be read as one, with the path that produced it. */
export class SkillParseError extends Error {
  override readonly name = 'SkillParseError';
  /** Path of the offending file, as the caller knows it. */
  readonly path: string;
  /** What is wrong, without the path — for messages that name their own. */
  readonly detail: string;
  /** 1-based line inside the document, where the failure has one. */
  readonly line?: number;

  constructor(path: string, detail: string, line?: number) {
    super(
      line === undefined
        ? `${path}: ${detail}`
        : `${path} (line ${line}): ${detail}`,
    );
    this.path = path;
    this.detail = detail;
    this.line = line;
  }
}

/** A parsed skill document. */
export interface ParsedSkillMd {
  readonly meta: SkillFrontmatter;
  /** The markdown after the closing fence, verbatim. */
  readonly body: string;
}

const OPENING_FENCE = /^---[ \t]*\r?\n/;
const CLOSING_FENCE = /\r?\n---[ \t]*(\r?\n|$)/;

function byteLength(text: string): number {
  // TextEncoder rather than Buffer: this module runs in the browser and in
  // Convex's V8 isolate as well as under Node.
  return new TextEncoder().encode(text).length;
}

/**
 * The document line the frontmatter mapping starts on — line 1 is always the
 * opening fence. Failures inside the block report against it, since the field
 * paths in the message already say which key is wrong.
 */
const FRONTMATTER_FIRST_LINE = 2;

/**
 * Parse a `SKILL.md` document into validated frontmatter plus its markdown
 * body. Throws {@link SkillParseError} — naming `path` — for anything that
 * is not a well-formed, schema-valid skill.
 */
export function parseSkillMd(content: string, path: string): ParsedSkillMd {
  const size = byteLength(content);
  if (size > MAX_SKILL_MD_BYTES) {
    throw new SkillParseError(
      path,
      `SKILL.md is ${size} bytes, over the ${MAX_SKILL_MD_BYTES}-byte limit`,
    );
  }

  const opening = OPENING_FENCE.exec(content);
  if (!opening || opening.index !== 0) {
    throw new SkillParseError(
      path,
      'SKILL.md must start with YAML frontmatter fenced by a "---" line',
      1,
    );
  }

  const afterOpening = content.slice(opening[0].length);
  const closing = CLOSING_FENCE.exec(afterOpening);
  if (!closing) {
    throw new SkillParseError(
      path,
      'the YAML frontmatter is never closed by a "---" line',
      1,
    );
  }

  const frontmatterText = afterOpening.slice(0, closing.index);
  const frontmatterBytes = byteLength(frontmatterText);
  if (frontmatterBytes > MAX_SKILL_FRONTMATTER_BYTES) {
    throw new SkillParseError(
      path,
      `frontmatter is ${frontmatterBytes} bytes, over the ${MAX_SKILL_FRONTMATTER_BYTES}-byte limit`,
      FRONTMATTER_FIRST_LINE,
    );
  }

  const parsed = parseYaml(frontmatterText, {
    maxBytes: MAX_SKILL_FRONTMATTER_BYTES,
  });
  if (!parsed.ok) {
    // The loader counts lines from the start of the frontmatter block, which
    // itself starts on the document's second line.
    throw new SkillParseError(path, parsed.error, FRONTMATTER_FIRST_LINE);
  }

  const validated = validateSkillFrontmatter(parsed.data);
  if (!validated.ok) {
    throw new SkillParseError(
      path,
      formatZodError(validated.error),
      FRONTMATTER_FIRST_LINE,
    );
  }

  return {
    meta: validated.meta,
    // The blank line conventionally separating the fence from the prose
    // belongs to the fence, not to the body — dropping it here is what makes
    // parse ∘ serialize a fixed point.
    body: afterOpening
      .slice(closing.index + closing[0].length)
      .replace(/^\r?\n/, ''),
  };
}

/**
 * Serialize frontmatter + body back into the on-disk `SKILL.md` form. The
 * body keeps its own text exactly; only the fenced mapping is rewritten, so
 * an edit that changes one field leaves the prose byte-identical.
 */
export function serializeSkillMd(meta: SkillFrontmatter, body: string): string {
  const frontmatter = stringifyYaml(skillFrontmatterToRaw(meta));
  const trimmed = body.replace(/^\r?\n/, '');
  const trailing = trimmed.length === 0 || trimmed.endsWith('\n') ? '' : '\n';
  return `---\n${frontmatter}---\n\n${trimmed}${trailing}`;
}
