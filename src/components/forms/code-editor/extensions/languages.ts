import { javascriptLanguage } from '@codemirror/lang-javascript';
import { jsonLanguage } from '@codemirror/lang-json';
import { yamlLanguage } from '@codemirror/lang-yaml';
import {
  defineLanguageFacet,
  Language,
  languageDataProp,
} from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import {
  parseMixed,
  type Input,
  type NestedParse,
  type SyntaxNodeRef,
} from '@lezer/common';
import {
  GFM,
  parser as markdownParser,
  type MarkdownConfig,
} from '@lezer/markdown';

import { codeTags, type CodeLanguage } from '../../../../lib/code-roles';
import { scanTemplates } from '../template-scan';
import { javascriptStyles, jsonStyles, yamlStyles } from './language-styles';
import {
  expressionParser,
  templateLanguage,
  templateOverlay,
  type TemplateScanner,
} from './template/parser';

/**
 * The language a code field is parsed as, for highlighting, bracket
 * matching, completion and syntax marks:
 *
 * - `javascript` — a script (a transform's body; a top-level `return` parses);
 * - `expression` — one expression (a condition);
 * - `json`, `yaml` — with `templates`, the `{{ js }}` inside string values
 *   are parsed as JavaScript; keys never hold templates;
 * - `markdown` — GitHub-flavoured Markdown, highlighting only; with
 *   `templates`, a template is one inline element (so `{{ a * b }}` is never
 *   emphasis) and templates in code spans and fenced code count too, as the
 *   engine interpolates there;
 * - `template` — text with templates; `text` — plain text, or text with
 *   templates when `templates` is on.
 */

const javascript = javascriptLanguage.configure({ props: [javascriptStyles] });

const expression = javascriptLanguage.configure(
  { top: 'SingleExpression', props: [javascriptStyles] },
  'expression',
);

function jsonWith(scanner: TemplateScanner | null): Language {
  if (scanner === null) return jsonLanguage.configure({ props: [jsonStyles] });
  return jsonLanguage.configure({
    props: [jsonStyles],
    wrap: parseMixed((node: SyntaxNodeRef, input: Input) =>
      node.name === 'String'
        ? templateOverlay(input, node.from + 1, node.to - 1, scanner)
        : null,
    ),
  });
}

function yamlWith(scanner: TemplateScanner | null): Language {
  if (scanner === null) return yamlLanguage.configure({ props: [yamlStyles] });
  return yamlLanguage.configure({
    props: [yamlStyles],
    wrap: parseMixed(
      (node: SyntaxNodeRef, input: Input): NestedParse | null => {
        if (node.name === 'Literal' || node.name === 'QuotedLiteral') {
          if (node.node.parent?.name === 'Key') return null;
          return node.name === 'QuotedLiteral'
            ? templateOverlay(input, node.from + 1, node.to - 1, scanner)
            : templateOverlay(input, node.from, node.to, scanner);
        }
        if (node.name === 'BlockLiteralContent') {
          return templateOverlay(input, node.from, node.to, scanner);
        }
        return null;
      },
    ),
  });
}

/** Prose: only `{` auto-closes (for `{{`); `<!-- -->` comments a line. */
const markdownData = defineLanguageFacet({
  closeBrackets: { brackets: ['{'] },
  commentTokens: { block: { open: '<!--', close: '-->' } },
});

/** A `{{ … }}` is one inline element, parsed before emphasis. */
function templateInline(scanner: TemplateScanner): MarkdownConfig {
  return {
    defineNodes: [
      { name: 'Template' },
      { name: 'TemplateBrace', style: codeTags.templateBrace },
      { name: 'TemplateBody' },
      { name: 'TemplateUnterminated', style: codeTags.templateUnterminated },
    ],
    parseInline: [
      {
        name: 'Template',
        before: 'Emphasis',
        parse(cx, next, pos) {
          if (next !== 123 || cx.char(pos + 1) !== 123) return -1;
          const { spans, unterminated } = scanner(cx.slice(pos, cx.end));
          const span = spans[0];
          if (span !== undefined && span.open === 0) {
            return cx.addElement(
              cx.elt('Template', pos, pos + span.end, [
                cx.elt('TemplateBrace', pos, pos + span.bodyFrom),
                cx.elt('TemplateBody', pos + span.bodyFrom, pos + span.bodyTo),
                cx.elt('TemplateBrace', pos + span.bodyTo, pos + span.end),
              ]),
            );
          }
          if (unterminated[0]?.[0] === 0) {
            return cx.addElement(cx.elt('TemplateUnterminated', pos, pos + 2));
          }
          return -1;
        },
      },
    ],
  };
}

function markdownWith(scanner: TemplateScanner | null): Language {
  const base = {
    props: [languageDataProp.add({ Document: markdownData })],
  };
  if (scanner === null) {
    return new Language(
      markdownData,
      markdownParser.configure([GFM, base]),
      [],
      'markdown',
    );
  }
  return new Language(
    markdownData,
    markdownParser.configure([
      GFM,
      templateInline(scanner),
      {
        ...base,
        wrap: parseMixed(
          (node: SyntaxNodeRef, input: Input): NestedParse | null => {
            if (node.name === 'TemplateBody')
              return { parser: expressionParser };
            if (node.name === 'CodeText') {
              return templateOverlay(input, node.from, node.to, scanner);
            }
            return null;
          },
        ),
      },
    ]),
    [],
    'markdown',
  );
}

const cache = new WeakMap<TemplateScanner, Map<string, Language | null>>();

/**
 * The parser for a field. `null` for plain text: no language, no tree.
 * Built once per language, template mode and scanner.
 */
export function codeLanguage(
  language: CodeLanguage,
  templates: boolean,
  scanner: TemplateScanner = scanTemplates,
): Language | null {
  let byKey = cache.get(scanner);
  if (byKey === undefined) {
    byKey = new Map();
    cache.set(scanner, byKey);
  }
  const key = `${language}:${templates}`;
  if (byKey.has(key)) return byKey.get(key) ?? null;
  const withTemplates = templates ? scanner : null;
  let built: Language | null;
  switch (language) {
    case 'javascript':
      built = javascript;
      break;
    case 'expression':
      built = expression;
      break;
    case 'json':
      built = jsonWith(withTemplates);
      break;
    case 'yaml':
      built = yamlWith(withTemplates);
      break;
    case 'markdown':
      built = markdownWith(withTemplates);
      break;
    case 'template':
      built = templateLanguage(scanner);
      break;
    case 'text':
      built = templates ? templateLanguage(scanner) : null;
      break;
  }
  byKey.set(key, built);
  return built;
}

/** Whether `{{ }}` templates are live in a field. */
export function templatesOn(
  language: CodeLanguage,
  templates: boolean,
): boolean {
  if (language === 'template') return true;
  if (language === 'javascript' || language === 'expression') return false;
  return templates;
}

/** The language extension, or nothing for plain text. */
export function languageExtension(
  language: CodeLanguage,
  templates: boolean,
  scanner?: TemplateScanner,
): Extension {
  return (
    codeLanguage(language, templatesOn(language, templates), scanner)
      ?.extension ?? []
  );
}
