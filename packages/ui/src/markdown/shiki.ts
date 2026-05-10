/**
 * Shared Shiki highlighter singleton.
 *
 * Strategy: 39 common grammars are statically imported so docs / web /
 * platform get them on first paint. Anything else is lazy-loaded on
 * demand via a runtime dynamic import. Shiki's JS regex engine keeps
 * the bundle off the WASM oniguruma path.
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [
        import('shiki/themes/github-dark.mjs'),
        import('shiki/themes/github-light.mjs'),
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
      ],
      engine: createJavaScriptRegexEngine(),
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
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
};

export function resolveLanguage(input: string | undefined): string {
  if (!input) return 'text';
  const lower = input.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
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

type ShikiTheme = 'light' | 'dark' | 'github-light' | 'github-dark';

function normalizeTheme(theme: ShikiTheme): 'github-dark' | 'github-light' {
  return theme === 'dark' || theme === 'github-dark'
    ? 'github-dark'
    : 'github-light';
}

/**
 * Tokenize `code` into highlighted HTML. Returns `null` when:
 *   - `code.length` exceeds `MAX_SHIKI_BYTES` (caller should plain-text)
 *   - the underlying highlighter fails to initialize or render
 *
 * Languages outside the eager list are lazy-loaded on first request and
 * cached for subsequent calls. Unknown grammars fall back to plaintext.
 */
export async function highlightCode(
  code: string,
  lang: string | undefined,
  theme: ShikiTheme = 'light',
): Promise<HighlightResult | null> {
  if (code.length > MAX_SHIKI_BYTES) return null;

  let highlighter: HighlighterCore;
  try {
    highlighter = await getHighlighter();
  } catch (err) {
    console.warn('[shiki] highlighter init failed:', err);
    return null;
  }

  const resolvedTheme = normalizeTheme(theme);
  const resolvedLang = resolveLanguage(lang);

  // Shiki's `text` grammar is a built-in no-highlight pass — there is no
  // `shiki/langs/text.mjs` to load. Skip the load attempt entirely.
  if (resolvedLang === 'text') {
    try {
      return {
        html: highlighter.codeToHtml(code, {
          lang: 'text',
          theme: resolvedTheme,
        }),
        language: 'text',
      };
    } catch (err) {
      console.warn('[shiki] codeToHtml failed for lang="text":', err);
      return null;
    }
  }

  const loaded = highlighter.getLoadedLanguages();
  if (!loaded.includes(resolvedLang)) {
    try {
      await highlighter.loadLanguage(
        /* @vite-ignore */ import(
          `shiki/langs/${resolvedLang}.mjs`
        ) as Parameters<HighlighterCore['loadLanguage']>[0],
      );
    } catch (err) {
      console.warn(
        `[shiki] language "${resolvedLang}" not loadable, falling back to plaintext:`,
        err,
      );
      try {
        return {
          html: highlighter.codeToHtml(code, {
            lang: 'text',
            theme: resolvedTheme,
          }),
          language: 'text',
        };
      } catch (htmlErr) {
        console.warn('[shiki] plaintext fallback failed:', htmlErr);
        return null;
      }
    }
  }

  try {
    return {
      html: highlighter.codeToHtml(code, {
        lang: resolvedLang,
        theme: resolvedTheme,
      }),
      language: resolvedLang,
    };
  } catch (err) {
    console.warn(`[shiki] codeToHtml failed for lang="${resolvedLang}":`, err);
    return null;
  }
}
