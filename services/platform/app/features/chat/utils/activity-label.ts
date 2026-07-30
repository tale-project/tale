/**
 * The timeline's human vocabulary, in one place so the step rows, the header,
 * and the source cards speak with one voice — "Searching knowledge base for
 * …", "Reading example.com".
 *
 * Pure — takes the `chat`-namespace translator so it runs in components,
 * memos, or tests without its own i18n context.
 */

import type { TFunction } from 'i18next';

/** The hostname of a URL, when it parses — shared by the "Reading {hostname}"
 * step titles and the web source cards' muted detail. */
export function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** What a tool step reads as: the tool plus its load-bearing facts. */
export interface StepActivity {
  readonly tool: string;
  /** The call's load-bearing argument (query / ref / url). */
  readonly detail?: string;
  /** The fetched document's filename, when the result named one. */
  readonly resultName?: string;
}

/**
 * The humanized title of one tool step — the same voice the 0.3 timeline
 * spoke. The retrieval tools carry exactly one human-meaningful argument
 * each; anything unknown falls back to the generic "Called {tool}".
 */
export function stepActivityLabel(t: TFunction, step: StepActivity): string {
  if (step.tool === 'rag_search') {
    return t('thinking.searchingKnowledgeBase', { query: step.detail ?? '' });
  }
  if (
    step.tool === 'web_fetch' ||
    (step.tool === 'rag_fetch' && step.detail?.startsWith('http') === true)
  ) {
    return t('thinking.reading', {
      hostname:
        step.detail !== undefined
          ? (hostnameOf(step.detail) ?? step.detail)
          : step.tool,
    });
  }
  if (step.tool === 'rag_fetch') {
    return t('thinking.readingDocument', {
      name: step.resultName ?? step.detail ?? step.tool,
    });
  }
  return t('parts.toolCall', { tool: step.tool });
}
