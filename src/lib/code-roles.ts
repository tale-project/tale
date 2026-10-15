import { Tag, tags as t } from '@lezer/highlight';

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

/** A role's colour as a CSS value, `var(--code-…)`. */
export function codeRoleColor(role: CodeRole): string {
  return `var(${codeRoleVariable(role)})`;
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

/* ---------------------------------------------------------- the editor */

/**
 * Tags the editor's languages attach where Lezer's standard tags do not
 * say enough to match the read-only colours: JSON and YAML keys, YAML plain
 * values, block scalars, and the braces of a `{{ }}` template. (The object
 * of a dot access, TextMate's `variable.other.object`, depends on the token
 * after it, which a tag cannot see: the editor marks it separately.)
 */
export const codeTags = {
  jsonKey: Tag.define(t.propertyName),
  yamlKey: Tag.define(t.propertyName),
  yamlValue: Tag.define(t.string),
  yamlBlock: Tag.define(t.string),
  templateBrace: Tag.define(t.brace),
  templateUnterminated: Tag.define(t.invalid),
};

/**
 * Which syntax tags take which colour role in the editor. The roles mirror
 * the read-only grammars' scopes (`code-roles.parity.test.ts` compares the
 * two per character); a more specific tag listed under one role wins over
 * its parent listed under another (`null` is a keyword in Lezer, a
 * constant here).
 */
export const CODE_ROLE_TAGS: Readonly<
  Partial<Record<CodeRole, readonly Tag[]>>
> = {
  keyword: [
    t.keyword,
    t.controlKeyword,
    t.definitionKeyword,
    t.moduleKeyword,
    t.operatorKeyword,
    t.modifier,
    t.operator,
    t.compareOperator,
    t.arithmeticOperator,
    t.logicOperator,
    t.bitwiseOperator,
    t.updateOperator,
    t.definitionOperator,
    t.typeOperator,
    t.controlOperator,
    t.function(t.punctuation),
    codeTags.jsonKey,
    codeTags.yamlKey,
    codeTags.templateBrace,
  ],
  'string-expression': [
    t.string,
    t.special(t.string),
    t.regexp,
    codeTags.yamlValue,
  ],
  string: [t.monospace, codeTags.yamlBlock],
  constant: [
    t.number,
    t.bool,
    t.null,
    t.atom,
    t.self,
    t.constant(t.variableName),
  ],
  function: [
    t.function(t.variableName),
    t.function(t.propertyName),
    t.function(t.definition(t.variableName)),
    t.typeName,
    t.className,
    t.definition(t.className),
    t.attributeName,
  ],
  comment: [t.comment, t.lineComment, t.blockComment, t.docComment],
  punctuation: [t.separator],
  // Names stay unstyled (the editor's text colour), so the mark that
  // colours the object of a dot access shows through them.
  foreground: [
    t.derefOperator,
    t.bracket,
    t.paren,
    t.brace,
    t.squareBracket,
    t.angleBracket,
    t.special(t.brace),
    t.escape,
    t.content,
    t.heading,
    t.processingInstruction,
    t.labelName,
    t.meta,
  ],
  link: [t.url, t.link],
  invalid: [t.invalid, codeTags.templateUnterminated],
};

/** Type styles that ride on top of a role colour. */
export const CODE_FONT_TAGS = {
  bold: [t.heading, t.strong] as readonly Tag[],
  italic: [t.emphasis] as readonly Tag[],
  strikethrough: [t.strikethrough] as readonly Tag[],
  underline: [t.link, t.url] as readonly Tag[],
};
