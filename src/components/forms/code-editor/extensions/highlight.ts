import { typescriptLanguage } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  highlightCode,
  tagHighlighter,
  type Highlighter,
  type Tag,
} from '@lezer/highlight';

import {
  CODE_FONT_TAGS,
  CODE_ROLE_TAGS,
  CODE_ROLES,
  codeRoleColor,
} from '../../../../lib/code-roles';

interface TagStyle {
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

/**
 * One style per tag, colour and type style merged: a highlighter keeps only
 * the last spec that names a tag, so a link's colour and its underline must
 * travel together.
 */
function tagStyles(): Map<Tag, TagStyle> {
  const styles = new Map<Tag, TagStyle>();
  const merge = (tag: Tag, style: TagStyle) => {
    styles.set(tag, { ...styles.get(tag), ...style });
  };
  for (const role of CODE_ROLES) {
    for (const tag of CODE_ROLE_TAGS[role] ?? []) {
      merge(tag, { color: codeRoleColor(role) });
    }
  }
  for (const tag of CODE_FONT_TAGS.bold) merge(tag, { fontWeight: '600' });
  for (const tag of CODE_FONT_TAGS.italic) merge(tag, { fontStyle: 'italic' });
  for (const tag of CODE_FONT_TAGS.underline) {
    merge(tag, { textDecoration: 'underline' });
  }
  for (const tag of CODE_FONT_TAGS.strikethrough) {
    merge(tag, { textDecoration: 'line-through' });
  }
  // Invalid text is underlined as well as coloured, so it never reads by
  // colour alone.
  for (const tag of CODE_ROLE_TAGS.invalid ?? []) {
    merge(tag, { textDecoration: 'underline dotted' });
  }
  return styles;
}

/** The editor's colours: the `--code-*` palette Shiki reads too. */
const codeHighlightStyle = HighlightStyle.define(
  Array.from(tagStyles(), ([tag, style]) => Object.assign({ tag }, style)),
);

export const codeHighlighting: Extension =
  syntaxHighlighting(codeHighlightStyle);

/**
 * The role each tag takes, as `role-<name>` classes — the parity test reads
 * a highlighted tree through this to compare roles with Shiki's.
 */
export const codeRoleHighlighter: Highlighter = tagHighlighter(
  CODE_ROLES.flatMap((role) => {
    const tags = CODE_ROLE_TAGS[role];
    return tags === undefined
      ? []
      : [{ tag: [...tags], class: `role-${role}` }];
  }),
);

/** A run of text and the classes that colour it. */
export interface HighlightedRun {
  text: string;
  className: string;
}

const TYPE_PREFIX = 'type _ = ';

/**
 * A TypeScript type (`{ count: number }`) as coloured runs, in the editor's
 * palette: the type info of a completion or a hover. Parsed as the right
 * side of a type alias, so any type reads as TypeScript does.
 */
export function highlightType(type: string): HighlightedRun[] {
  const source = `${TYPE_PREFIX}${type}`;
  const tree = typescriptLanguage.parser.parse(source);
  const runs: HighlightedRun[] = [];
  highlightCode(
    source,
    tree,
    codeHighlightStyle,
    (text, className) => runs.push({ text, className }),
    () => runs.push({ text: '\n', className: '' }),
    TYPE_PREFIX.length,
    source.length,
  );
  return runs;
}
