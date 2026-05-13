/**
 * Cap on how many entries the inlined `versionHistory` array on each
 * promptTemplates row keeps. When a publish would push past this, the oldest
 * entry is dropped (FIFO) and a `prompt_template.history_truncated` audit
 * event is emitted (see version_history.ts + mutations.ts).
 */
export const MAX_PROMPT_VERSION_HISTORY = 12;

/**
 * Per-version content byte cap (UTF-8). 16 KiB ≈ 4,000 tokens, which covers
 * ~95% of real-world prompt templates including modest few-shot. Production
 * system prompts typically run ~1,200 tokens (~5 KB); the upper-bound
 * industry guidance is ~2,500 tokens (~10 KB) for analytical tools. Above
 * that range, content is usually a document that belongs in RAG, not in a
 * prompt template.
 *
 * Doc-size budget (Convex per-document limit is 1 MiB):
 *   row metadata: 200 (title) + 2000 (desc) + 100 (category) + 20×50 (tags) ≈ 3.3 KB
 * + versionHistory (current + history): 13 × (16,384 + ~3.3 KB metadata) ≈ 256 KB
 * = ≈ 260 KB total, leaving ~760 KB headroom.
 */
export const MAX_PROMPT_CONTENT_BYTES = 16_384;

/** Character counts measure trimmed string length. Whitespace cannot pad past
 * the cap — see assertPromptSizes / normalizePromptFields in size_guards.ts. */
export const MAX_PROMPT_TITLE_LEN = 200;
export const MAX_PROMPT_DESCRIPTION_LEN = 2_000;
export const MAX_PROMPT_CATEGORY_LEN = 100;
export const MAX_PROMPT_TAG_LEN = 50;
export const MAX_PROMPT_TAGS_COUNT = 20;
