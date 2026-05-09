// Re-exported from @tale/markdown so existing call sites keep their import
// path while the canonical singleton (and language list) lives in the
// shared package.
export {
  highlightCode,
  resolveLanguage,
  MAX_SHIKI_BYTES,
  type HighlightResult,
} from '@tale/markdown/shiki';
