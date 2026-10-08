/**
 * The colour roles of highlighted code — the one vocabulary the read-only
 * renderer (Shiki) and the code editor (CodeMirror) share.
 *
 * Each role is a CSS variable in `globals.css` (`:root` and `.dark`). Shiki
 * reads them through its css-variables theme (prefix `--code-`, so its own
 * names line up with ours); the editor's highlight style maps its syntax tags
 * onto the same variables. A value therefore has one colour wherever it
 * shows, and a theme switch changes the variables, not the highlighted HTML.
 */

/**
 * What a code field holds, for the editor and for read-only highlighting.
 *
 * - `javascript` — a script: statements, a top-level `return` (a transform
 *   node's code).
 * - `expression` — one JavaScript expression (a bare condition).
 * - `json`, `yaml`.
 * - `markdown` — GitHub-flavoured Markdown, highlighted only (no preview).
 * - `template` — text with `{{ js }}` expressions in it.
 * - `text` — plain text.
 */
export type CodeLanguage =
  | 'javascript'
  | 'expression'
  | 'json'
  | 'yaml'
  | 'markdown'
  | 'template'
  | 'text';

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  'javascript',
  'expression',
  'json',
  'yaml',
  'markdown',
  'template',
  'text',
];

export const CODE_ROLES = [
  'foreground',
  'keyword',
  'string',
  'string-expression',
  'constant',
  'function',
  'parameter',
  'comment',
  'punctuation',
  'link',
  'inserted',
  'deleted',
  'changed',
  'invalid',
] as const;

export type CodeRole = (typeof CODE_ROLES)[number];

/** The CSS variable that holds a role's colour. */
function codeRoleVariable(role: CodeRole): string {
  if (role === 'foreground') return '--code-foreground';
  if (role === 'invalid') return '--code-invalid';
  return `--code-token-${role}`;
}

const ROLE_BY_VARIABLE = new Map<string, CodeRole>(
  CODE_ROLES.map((role) => [codeRoleVariable(role), role]),
);

/**
 * The role a highlighted token's colour names (`var(--code-token-keyword)`
 * → `keyword`); `null` for a colour outside the palette. Shiki's
 * css-variables theme writes exactly these values.
 */
export function codeRoleOfColor(color: string | undefined): CodeRole | null {
  if (color === undefined) return null;
  const match = /^var\((--code-[a-z-]+)(?:,[^)]*)?\)$/i.exec(color.trim());
  if (match === null) return null;
  return ROLE_BY_VARIABLE.get(match[1].toLowerCase()) ?? null;
}
