/**
 * Shared Shiki syntax highlighter singleton.
 * Lazy-initialized with on-demand language loading to minimize bundle size.
 * Used by chat code blocks and document text preview.
 */

import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['github-dark', 'github-light'],
      langs: [],
    });
  }
  return highlighterPromise;
}

const LANG_ALIASES: Record<string, string> = {
  // Python
  py: 'python', pyi: 'python', pyw: 'python',
  // JavaScript/TypeScript
  js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx', mts: 'typescript', cts: 'typescript',
  // Systems
  rs: 'rust', rb: 'ruby', kt: 'kotlin', kts: 'kotlin',
  // Shell
  sh: 'bash', zsh: 'bash', fish: 'fish',
  ps1: 'powershell', bat: 'bat', cmd: 'bat',
  // Config / data
  yml: 'yaml', md: 'markdown', mdx: 'mdx',
  // C/C++
  cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  h: 'c',
  // Web
  htm: 'html', scss: 'scss', sass: 'sass', less: 'less',
  // Other
  ex: 'elixir', exs: 'elixir',
  gql: 'graphql',
  tex: 'latex', latex: 'latex',
  pl: 'perl', pm: 'perl',
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
      await hl.loadLanguage(resolvedLang as Parameters<Highlighter['loadLanguage']>[0]);
    } catch {
      return '';
    }
  }

  return hl.codeToHtml(code, { lang: resolvedLang, theme });
}
