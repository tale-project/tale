/**
 * Shared Shiki highlighter singleton.
 *
 * Strategy: the engine, the theme and 39 common grammars load together the
 * first time code is highlighted (or `preloadHighlighter` asks), not with the
 * page: a chat or a docs page without code never needs them. Anything else is
 * lazy-loaded on demand via a runtime dynamic import. Shiki's JS regex engine
 * keeps the bundle off the WASM oniguruma path.
 *
 * Colours come from the `--code-*` variables in `globals.css` (Shiki's
 * css-variables theme), the palette the code editor reads too. One
 * highlight therefore serves light and dark alike: a theme switch repaints
 * the variables and never tokenizes again.
 */

import type { HighlighterCore, ThemeRegistration } from 'shiki/core';

import type { CodeLanguage } from '../lib/code-roles';
import { TEMPLATE_GRAMMARS } from './shiki-template-grammars';

let highlighterPromise: Promise<HighlighterCore> | null = null;

/** The one theme the highlighter loads. */
export const SHIKI_THEME = 'tale-code';

/**
 * The css-variables theme colours a unified diff's added, removed and
 * changed lines; the hunk ranges and file headers get the function and
 * changed roles, as the min-* themes' diff colours did before.
 */
function withDiffScopes(theme: ThemeRegistration): ThemeRegistration {
  return {
    ...theme,
    tokenColors: [
      ...(theme.tokenColors ?? []),
      {
        scope: ['meta.diff.range', 'punctuation.definition.range.diff'],
        settings: { foreground: 'var(--code-token-function)' },
      },
      {
        scope: ['meta.diff.header', 'meta.diff.index'],
        settings: { foreground: 'var(--code-token-changed)' },
      },
    ],
  };
}

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
      .then(
        ([
          { createCssVariablesTheme, createHighlighterCore },
          { createJavaScriptRegexEngine },
        ]) =>
          createHighlighterCore({
            themes: [
              withDiffScopes(
                createCssVariablesTheme({
                  name: SHIKI_THEME,
                  variablePrefix: '--code-',
                  fontStyle: true,
                }),
              ),
            ],
            langs: [
              import('shiki/langs/bash.mjs'),
              import('shiki/langs/c.mjs'),
              import('shiki/langs/cpp.mjs'),
              import('shiki/langs/csharp.mjs'),
              import('shiki/langs/css.mjs'),
              import('shiki/langs/diff.mjs'),
              import('shiki/langs/docker.mjs'),
              import('shiki/langs/dotenv.mjs'),
              import('shiki/langs/elixir.mjs'),
              import('shiki/langs/go.mjs'),
              import('shiki/langs/graphql.mjs'),
              import('shiki/langs/hcl.mjs'),
              import('shiki/langs/html.mjs'),
              import('shiki/langs/http.mjs'),
              import('shiki/langs/ini.mjs'),
              import('shiki/langs/java.mjs'),
              import('shiki/langs/javascript.mjs'),
              import('shiki/langs/json.mjs'),
              import('shiki/langs/jsx.mjs'),
              import('shiki/langs/kotlin.mjs'),
              import('shiki/langs/lua.mjs'),
              import('shiki/langs/markdown.mjs'),
              import('shiki/langs/nginx.mjs'),
              import('shiki/langs/php.mjs'),
              import('shiki/langs/powershell.mjs'),
              import('shiki/langs/prisma.mjs'),
              import('shiki/langs/python.mjs'),
              import('shiki/langs/ruby.mjs'),
              import('shiki/langs/rust.mjs'),
              import('shiki/langs/scala.mjs'),
              import('shiki/langs/scss.mjs'),
              import('shiki/langs/sql.mjs'),
              import('shiki/langs/swift.mjs'),
              import('shiki/langs/toml.mjs'),
              import('shiki/langs/tsx.mjs'),
              import('shiki/langs/typescript.mjs'),
              import('shiki/langs/xml.mjs'),
              import('shiki/langs/yaml.mjs'),
              import('shiki/langs/zig.mjs'),
              // After javascript, json, yaml and markdown, which they embed.
              ...TEMPLATE_GRAMMARS,
            ],
            engine: createJavaScriptRegexEngine(),
          }),
      )
      .catch((error: unknown) => {
        highlighterPromise = null;
        throw error;
      });
  }
  return highlighterPromise;
}

/**
 * Warm the highlighter singleton (engine + themes + eager grammars) ahead of
 * first use. The init is otherwise lazy, paid on the first `highlightCode`
 * call — so the first file a user opens flashes un-highlighted while the
 * dynamic imports resolve. Call this on mount of any surface that's about to
 * render code (e.g. the canvas) so highlighting is ready by the time content
 * lands. Idempotent (the promise is cached) and fire-and-forget.
 */
export function preloadHighlighter(): void {
  void getHighlighter().catch((error) => {
    // Already reset+rethrown inside getHighlighter; log so the preload doesn't
    // surface an unhandled rejection, and let the next real call retry.
    console.warn('[shiki] preload failed:', error);
  });
}

const LANG_ALIASES: Record<string, string> = {
  plaintext: 'text',
  txt: 'text',
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  // `node` is the source language for node_runnable artifacts; the LLM
  // and the artifact_create tool both emit this token. Without an alias
  // shiki falls back to plaintext.
  node: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  ps1: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  htm: 'html',
  dockerfile: 'docker',
  env: 'dotenv',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  h: 'c',
  cs: 'csharp',
  ex: 'elixir',
  exs: 'elixir',
  gql: 'graphql',
  terraform: 'hcl',
  tf: 'hcl',
  // Unified diffs: `.patch`/`.diff` files share the one `diff` grammar.
  patch: 'diff',
  // Tale's `{{ js }}` templates (see `shiki-template-grammars.ts`).
  template: 'tale-template',
  'text+template': 'tale-template',
  'json+template': 'json-template',
  'yaml+template': 'yaml-template',
  'yml+template': 'yaml-template',
  'markdown+template': 'markdown-template',
  'md+template': 'markdown-template',
};

export function resolveLanguage(input: string | undefined): string {
  if (!input) return 'text';
  const lower = input.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

/**
 * The Shiki language that shows a code field's text the way the code editor
 * highlights it: an expression and a script are both JavaScript, and a field
 * that may hold `{{ js }}` templates gets its template-aware grammar.
 * `templates` is implied by `template` and ignored for JavaScript.
 */
export function shikiLanguageFor(
  language: CodeLanguage,
  templates = false,
): string {
  switch (language) {
    case 'javascript':
    case 'expression':
      return 'javascript';
    case 'template':
      return 'tale-template';
    case 'json':
      return templates ? 'json-template' : 'json';
    case 'yaml':
      return templates ? 'yaml-template' : 'yaml';
    case 'markdown':
      return templates ? 'markdown-template' : 'markdown';
    case 'text':
      return templates ? 'tale-template' : 'text';
  }
}

/**
 * Cap on the input size we'll synchronously tokenize on the main thread.
 * Above this, callers should fall back to a plain-text render — Shiki's
 * `codeToHtml` is O(n) but blocking, and on a 250 KB document the freeze
 * runs 300 ms-2 s on a mid-range laptop.
 */
export const MAX_SHIKI_BYTES = 64_000;

export interface HighlightResult {
  html: string;
  language: string;
}

/**
 * The theme names callers passed before the palette moved into CSS
 * variables. Every one of them still works and means the same now.
 */
export type ShikiTheme =
  | 'light'
  | 'dark'
  | 'github-light'
  | 'github-dark'
  | 'min-light'
  | 'min-dark';

/**
 * Map every theme alias a caller may still pass (light or dark, and the
 * historical `github-*` and `min-*` names) onto the one theme the
 * highlighter loads. Its colours are CSS variables that follow the page's
 * theme, so the light/dark choice no longer reaches Shiki at all.
 */
export function resolveShikiTheme(_theme?: ShikiTheme): typeof SHIKI_THEME {
  return SHIKI_THEME;
}

/**
 * The highlighted HTML of the snippets highlighted lately, newest last. A
 * chat highlighted every code block again each time it opened — Shiki's
 * tokenizer is the most expensive step of rendering a reply — and showed it
 * unhighlighted until then. Bounded by the HTML it holds; the oldest entry
 * leaves first.
 */
const highlighted = new Map<string, HighlightResult>();
let highlightedChars = 0;
const HIGHLIGHTED_MAX_CHARS = 4_000_000;

/** One entry per snippet and language: the HTML is the same in both themes. */
function highlightKey(code: string, lang: string | undefined): string {
  return `${resolveLanguage(lang)}\u0000${code}`;
}

function remember(key: string, result: HighlightResult): void {
  const known = highlighted.get(key);
  if (known !== undefined) {
    highlighted.delete(key);
    highlightedChars -= known.html.length;
  }
  highlighted.set(key, result);
  highlightedChars += result.html.length;
  for (const [oldest, entry] of highlighted) {
    if (highlightedChars <= HIGHLIGHTED_MAX_CHARS) break;
    highlighted.delete(oldest);
    highlightedChars -= entry.html.length;
  }
}

/**
 * The highlight `highlightCode` already made for this snippet, if it still
 * holds one — synchronous, so a code block shown before renders highlighted
 * from its first frame instead of flashing plain text.
 */
export function peekHighlightedCode(
  code: string,
  lang: string | undefined,
  _theme?: ShikiTheme,
): HighlightResult | null {
  return highlighted.get(highlightKey(code, lang)) ?? null;
}

/**
 * Tokenize `code` into highlighted HTML. Returns `null` when:
 *   - `code.length` exceeds `MAX_SHIKI_BYTES` (caller should plain-text)
 *   - the underlying highlighter fails to initialize or render
 *
 * Languages outside the eager list are lazy-loaded on first request and
 * cached for subsequent calls. Unknown grammars fall back to plaintext. A
 * snippet highlighted before answers from {@link peekHighlightedCode}'s
 * store without tokenizing again. The HTML colours through the `--code-*`
 * variables, so it is right in either theme; `_theme` is accepted for
 * callers that still pass one.
 */
export async function highlightCode(
  code: string,
  lang: string | undefined,
  _theme?: ShikiTheme,
): Promise<HighlightResult | null> {
  if (code.length > MAX_SHIKI_BYTES) return null;
  const key = highlightKey(code, lang);
  const known = highlighted.get(key);
  if (known !== undefined) {
    remember(key, known);
    return known;
  }
  const result = await tokenize(code, lang);
  if (result !== null) remember(key, result);
  return result;
}

/**
 * The language the highlighter will tokenize `lang` as: the grammar once it
 * is loaded (a language outside the eager list loads on first use), else
 * plain text when it cannot be loaded.
 */
async function loadedLanguage(
  highlighter: HighlighterCore,
  lang: string | undefined,
): Promise<string> {
  const resolvedLang = resolveLanguage(lang);
  // Shiki's `text` grammar is a built-in no-highlight pass — there is no
  // `shiki/langs/text.mjs` to load. Skip the load attempt entirely.
  if (resolvedLang === 'text') return 'text';
  if (highlighter.getLoadedLanguages().includes(resolvedLang))
    return resolvedLang;
  try {
    await highlighter.loadLanguage(
      // Vite analyses dynamic imports statically; the `@vite-ignore`
      // comment must sit *inside* the `import()` call (not in front of
      // it) for Vite to honour it, hence the awkward placement.
      import(
        /* @vite-ignore */ `shiki/langs/${resolvedLang}.mjs`
      ) as Parameters<HighlighterCore['loadLanguage']>[0],
    );
    return resolvedLang;
  } catch (err) {
    console.warn(
      `[shiki] language "${resolvedLang}" not loadable, falling back to plaintext:`,
      err,
    );
    return 'text';
  }
}

async function tokenize(
  code: string,
  lang: string | undefined,
): Promise<HighlightResult | null> {
  let highlighter: HighlighterCore;
  try {
    highlighter = await getHighlighter();
  } catch (err) {
    console.warn('[shiki] highlighter init failed:', err);
    return null;
  }
  const language = await loadedLanguage(highlighter, lang);
  try {
    return {
      html: highlighter.codeToHtml(code, {
        lang: language,
        theme: SHIKI_THEME,
      }),
      language,
    };
  } catch (err) {
    console.warn(`[shiki] codeToHtml failed for lang="${language}":`, err);
    return null;
  }
}

/** A highlighted run of one line: its text, its colour (`var(--code-…)`)
 *  and Shiki's font style bits (1 italic, 2 bold, 4 underline). */
export interface CodeToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

/** A text's tokens, line by line. */
export type CodeTokenLines = readonly (readonly CodeToken[])[];

/**
 * The tokens of the texts tokenized lately, newest last, bounded by the
 * text they hold, as {@link highlightCode}'s HTML is. A diff tokenizes each
 * whole text once — a YAML block scalar highlights right only in its whole
 * document — and maps the tokens back to the lines it shows.
 */
const tokenized = new Map<string, CodeTokenLines>();
const tokenizedSizes = new Map<string, number>();
let tokenizedChars = 0;

function rememberTokens(key: string, lines: CodeTokenLines, size: number) {
  const known = tokenizedSizes.get(key);
  if (known !== undefined) {
    tokenized.delete(key);
    tokenizedChars -= known;
  }
  tokenized.set(key, lines);
  tokenizedSizes.set(key, size);
  tokenizedChars += size;
  for (const [oldest] of tokenized) {
    if (tokenizedChars <= HIGHLIGHTED_MAX_CHARS) break;
    tokenized.delete(oldest);
    tokenizedChars -= tokenizedSizes.get(oldest) ?? 0;
    tokenizedSizes.delete(oldest);
  }
}

/** The tokens {@link tokenizeCode} already made for this text, if it still
 *  holds them — synchronous, so a text shown before renders highlighted
 *  from its first frame. */
export function peekCodeTokens(
  code: string,
  lang: string | undefined,
): CodeTokenLines | null {
  return tokenized.get(highlightKey(code, lang)) ?? null;
}

/**
 * Tokenize `code` into highlighted runs per line, in the same colours as
 * {@link highlightCode}'s HTML. Returns `null` past {@link MAX_SHIKI_BYTES}
 * or when the highlighter fails; a language that cannot be loaded comes
 * back as plain text.
 */
export async function tokenizeCode(
  code: string,
  lang: string | undefined,
): Promise<CodeTokenLines | null> {
  if (code.length > MAX_SHIKI_BYTES) return null;
  const key = highlightKey(code, lang);
  const known = tokenized.get(key);
  if (known !== undefined) {
    rememberTokens(key, known, code.length);
    return known;
  }
  let highlighter: HighlighterCore;
  try {
    highlighter = await getHighlighter();
  } catch (err) {
    console.warn('[shiki] highlighter init failed:', err);
    return null;
  }
  const language = await loadedLanguage(highlighter, lang);
  try {
    const { tokens } = highlighter.codeToTokens(code, {
      lang: language,
      theme: SHIKI_THEME,
    });
    const lines: CodeTokenLines = tokens.map((line) =>
      line.map((token) => {
        // Shiki's style is a bit set; -1 (not set) and 0 mean plain.
        const fontStyle: number = token.fontStyle ?? 0;
        return {
          content: token.content,
          ...(token.color === undefined ? {} : { color: token.color }),
          ...(fontStyle > 0 ? { fontStyle } : {}),
        };
      }),
    );
    rememberTokens(key, lines, code.length);
    return lines;
  } catch (err) {
    console.warn(`[shiki] codeToTokens failed for lang="${language}":`, err);
    return null;
  }
}
