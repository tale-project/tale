/**
 * Frontmatter parser for the limited shape used by Tale's markdown:
 * `key: value` pairs, optionally quoted, with `true`/`false` literals
 * coerced to booleans. Anything else is treated as a string. Lifted from
 * `services/web/lib/legal/content.ts` so docs can reuse it.
 */

export interface Frontmatter {
  [key: string]: string | boolean;
}

export interface ParseResult {
  frontmatter: Frontmatter;
  content: string;
}

export function parseFrontmatter(raw: string): ParseResult {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { frontmatter: {}, content: raw };

  const [, block, body] = match;
  const fm: Frontmatter = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    let value = line.slice(colon + 1).trim();
    if (
      (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) ||
      (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
      fm[key] = value;
      continue;
    }
    // Strip YAML trailing comments on unquoted values: ` # ...` to end of line.
    // Only when `#` is preceded by whitespace, matching YAML semantics.
    const commentMatch = /\s#.*$/.exec(value);
    if (commentMatch) value = value.slice(0, commentMatch.index).trimEnd();
    if (value === 'true' || value === 'false') {
      fm[key] = value === 'true';
      continue;
    }
    fm[key] = value;
  }
  return { frontmatter: fm, content: body.replace(/^\r?\n/, '') };
}
