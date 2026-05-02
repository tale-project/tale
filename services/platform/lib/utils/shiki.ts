/**
 * Shared Shiki syntax highlighter singleton.
 * Uses shiki/core with the JavaScript regex engine to avoid bundling
 * the full WASM-based oniguruma engine and all grammars/themes.
 * Lazy-initialized with on-demand language loading to minimize bundle size.
 * Used by chat code blocks and document text preview.
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
      langs: [],
      engine: createJavaScriptRegexEngine(),
    }).catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

const LANG_ALIASES: Record<string, string> = {
  // Plain text — Shiki's built-in no-highlight grammar is named `text`
  // (no `langs/text.mjs` file ships); without this alias every undefined-
  // language render warns about a missing `langs/plaintext.mjs`.
  plaintext: 'text',
  txt: 'text',
  // Python
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  // Systems
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  kts: 'kotlin',
  // Shell
  sh: 'bash',
  zsh: 'bash',
  fish: 'fish',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  // Config / data
  yml: 'yaml',
  md: 'markdown',
  mdx: 'mdx',
  // C/C++
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  h: 'c',
  // Web
  htm: 'html',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  // Other
  ex: 'elixir',
  exs: 'elixir',
  gql: 'graphql',
  tex: 'latex',
  latex: 'latex',
  pl: 'perl',
  pm: 'perl',
  r: 'r',
};

export function resolveLanguage(langOrExt: string): string {
  const lower = langOrExt.toLowerCase();
  return LANG_ALIASES[lower] || lower;
}

/**
 * Cap on the input size we'll synchronously tokenize on the main thread.
 * Above this, callers should fall back to a plain-text render — Shiki's
 * `codeToHtml` is O(n) but blocking, and on a 250 KB document the freeze
 * runs 300 ms-2 s on a mid-range laptop.
 *
 * Hunk views call shiki per-hunk (≤ a few KB each), so they sit well below
 * this cap; only the settled-source full-document path can hit it.
 */
const MAX_SHIKI_BYTES = 64_000;

/**
 * Tokenize `code` into highlighted HTML. Returns `null` when:
 *   - `code.length` exceeds `MAX_SHIKI_BYTES` (caller should plain-text)
 *   - the underlying highlighter fails to initialize or render
 *
 * Note: Shiki's `codeToHtml` produces HTML built from a fixed grammar set
 * with all user content escaped via innerText — there is no path for user
 * code to inject HTML attributes or scripts. We deliberately do NOT wrap
 * the output in `DOMPurify.sanitize`: it costs ~100-400 ms on large
 * documents while removing nothing Shiki itself emits.
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: 'github-dark' | 'github-light' = 'github-dark',
): Promise<string | null> {
  if (code.length > MAX_SHIKI_BYTES) return null;

  let hl: HighlighterCore;
  try {
    hl = await getHighlighter();
  } catch (err) {
    console.warn('[shiki] highlighter init failed:', err);
    return null;
  }

  const resolvedLang = resolveLanguage(lang);

  // Shiki's `text` grammar is a built-in no-highlight pass — there is no
  // `shiki/langs/text.mjs` to load. Skip the load attempt entirely; without
  // this short-circuit we'd hit the catch path and log a spurious warning
  // for every plaintext render.
  if (resolvedLang === 'text') {
    try {
      return hl.codeToHtml(code, { lang: 'text', theme });
    } catch (err) {
      console.warn('[shiki] codeToHtml failed for lang="text":', err);
      return null;
    }
  }

  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(resolvedLang)) {
    try {
      await hl.loadLanguage(
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
        return hl.codeToHtml(code, { lang: 'text', theme });
      } catch (htmlErr) {
        console.warn('[shiki] plaintext fallback failed:', htmlErr);
        return null;
      }
    }
  }

  try {
    return hl.codeToHtml(code, { lang: resolvedLang, theme });
  } catch (err) {
    console.warn(`[shiki] codeToHtml failed for lang="${resolvedLang}":`, err);
    return null;
  }
}
