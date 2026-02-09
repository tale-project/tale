/**
 * Shared Shiki syntax highlighter singleton.
 * Uses shiki/core with the JavaScript regex engine to avoid bundling
 * the full WASM-based oniguruma engine and all grammars/themes.
 * Lazy-initialized with on-demand language loading to minimize bundle size.
 * Used by chat code blocks and document text preview.
 */

import DOMPurify from 'dompurify';
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

export async function highlightCode(
  code: string,
  lang: string,
  theme: 'github-dark' | 'github-light' = 'github-dark',
): Promise<string> {
  const hl = await getHighlighter();
  const resolvedLang = resolveLanguage(lang);

  const loadedLangs = hl.getLoadedLanguages();
  if (!loadedLangs.includes(resolvedLang)) {
    try {
      await hl.loadLanguage(
        import(`shiki/langs/${resolvedLang}.mjs`) as Parameters<
          HighlighterCore['loadLanguage']
        >[0],
      );
    } catch {
      return DOMPurify.sanitize(hl.codeToHtml(code, { lang: 'text', theme }));
    }
  }

  return DOMPurify.sanitize(hl.codeToHtml(code, { lang: resolvedLang, theme }));
}
