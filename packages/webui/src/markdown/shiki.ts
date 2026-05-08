/**
 * Shared Shiki highlighter singleton. JS regex engine + statically-imported
 * common grammars keep the bundle small while making sure every language we
 * actually use in docs/markdown highlights without needing a runtime
 * resolver — Vite cannot bundle `shiki/langs/${lang}.mjs` reliably from a
 * dynamic specifier, so we declare the list up front.
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
        import('shiki/langs/css.mjs'),
        import('shiki/langs/diff.mjs'),
        import('shiki/langs/docker.mjs'),
        import('shiki/langs/dotenv.mjs'),
        import('shiki/langs/html.mjs'),
        import('shiki/langs/http.mjs'),
        import('shiki/langs/javascript.mjs'),
        import('shiki/langs/json.mjs'),
        import('shiki/langs/jsx.mjs'),
        import('shiki/langs/markdown.mjs'),
        import('shiki/langs/nginx.mjs'),
        import('shiki/langs/powershell.mjs'),
        import('shiki/langs/python.mjs'),
        import('shiki/langs/sql.mjs'),
        import('shiki/langs/tsx.mjs'),
        import('shiki/langs/typescript.mjs'),
        import('shiki/langs/xml.mjs'),
        import('shiki/langs/yaml.mjs'),
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
};

function resolveLang(input: string | undefined): string {
  if (!input) return 'text';
  const lower = input.toLowerCase();
  return LANG_ALIASES[lower] ?? lower;
}

export interface HighlightResult {
  html: string;
  language: string;
}

export async function highlightCode(
  code: string,
  lang: string | undefined,
  theme: 'light' | 'dark' = 'light',
): Promise<HighlightResult> {
  const resolved = resolveLang(lang);
  const highlighter = await getHighlighter();
  const loaded = highlighter.getLoadedLanguages();
  const final = loaded.includes(resolved) ? resolved : 'text';
  const html = highlighter.codeToHtml(code, {
    lang: final,
    theme: theme === 'dark' ? 'github-dark' : 'github-light',
  });
  return { html, language: final };
}
