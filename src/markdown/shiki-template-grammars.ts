import type { LanguageRegistration } from 'shiki/core';

/**
 * Read-only highlighting for Tale's `{{ js }}` templates.
 *
 * One injection grammar finds `{{ … }}` and highlights its body as a
 * JavaScript expression; four wrapper languages decide where it may fire:
 *
 * - `tale-template` — plain text with templates (a forEach, a prompt line);
 * - `json-template` — templates inside JSON strings (a connector's input);
 * - `yaml-template` — templates inside YAML scalars (an automation file);
 * - `markdown-template` — templates anywhere in Markdown but its comments.
 *
 * The injection only fires under these wrappers' own root scopes, so a
 * Helm, Jinja or Go-template YAML file in a chat answer (plain `yaml`) keeps
 * its braces as text. The body uses the JavaScript grammar's `expression`
 * rules, which consume brackets and strings, so `{{ "}}" }}` and
 * `{{ ({ a: { b: 1 } }) }}` close at the right brace. A template the line
 * ends inside stops at the end of that line — display only; the editor and
 * the engine judge where a template really ends.
 */

const INJECTION_SCOPE = 'tale.template.injection';

const templateInjection: LanguageRegistration = {
  name: 'tale-template-injection',
  scopeName: INJECTION_SCOPE,
  injectTo: [
    'source.tale-template',
    'source.tale-json',
    'source.tale-yaml',
    'text.tale-markdown',
  ],
  injectionSelector:
    'L:source.tale-template, L:source.tale-json string, L:source.tale-yaml string, L:text.tale-markdown -comment',
  embeddedLangs: ['javascript'],
  patterns: [{ include: '#template' }],
  repository: {
    template: {
      begin: '\\{\\{',
      end: '\\}\\}|$',
      name: 'meta.template.expression.tale',
      beginCaptures: {
        0: { name: 'punctuation.definition.template-expression.begin.tale' },
      },
      endCaptures: {
        0: { name: 'punctuation.definition.template-expression.end.tale' },
      },
      contentName: 'meta.embedded.expression.tale source.js',
      patterns: [{ include: 'source.js#expression' }],
    },
  },
};

function wrapper(
  name: string,
  scopeName: string,
  include: string,
  base: string[],
): LanguageRegistration {
  return {
    name,
    scopeName,
    patterns: include === '' ? [] : [{ include }],
    repository: {},
    embeddedLangs: [...base, 'tale-template-injection'],
  };
}

/**
 * Every grammar the template languages need, the injection first. Register
 * them together with `javascript`, `json`, `yaml` and `markdown`.
 */
export const TEMPLATE_GRAMMARS: readonly LanguageRegistration[] = [
  templateInjection,
  wrapper('tale-template', 'source.tale-template', '', []),
  wrapper('json-template', 'source.tale-json', 'source.json', ['json']),
  wrapper('yaml-template', 'source.tale-yaml', 'source.yaml', ['yaml']),
  wrapper('markdown-template', 'text.tale-markdown', 'text.html.markdown', [
    'markdown',
  ]),
];
