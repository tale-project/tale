/**
 * The timeline's human vocabulary, in one place so the step rows, the header,
 * and the source cards speak with one voice — "Searching knowledge base for
 * …", "Reading example.com".
 *
 * Pure — takes the `chat`-namespace translator so it runs in components,
 * memos, or tests without its own i18n context.
 */

import type { TFunction } from 'i18next';

import { isRecord } from '@/lib/utils/type-utils';

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
  /** The raw call arguments, for the labels one argument cannot carry —
   * a rag_search list call has no query, only filters. */
  readonly input?: unknown;
}

/** Label key per listed kind — literal strings, so the i18n usage scan sees
 * every key. Anything unknown (or a kind added later) falls back to the
 * generic line rather than an empty-quotes search label. */
const LISTING_LABEL_KEYS: Record<string, string> = {
  task: 'thinking.listing.tasks',
  project: 'thinking.listing.projects',
  contact: 'thinking.listing.contacts',
  product: 'thinking.listing.products',
  document: 'thinking.listing.documents',
  website: 'thinking.listing.websites',
  'knowledge-entry': 'thinking.listing.knowledgeEntries',
  conversation: 'thinking.listing.conversations',
  'mail-attachment': 'thinking.listing.mailAttachments',
};

/**
 * The kind a rag_search call is LISTING, when it is one. An explicit
 * `action: 'list'` decides; a call with a kind and no query is the same
 * intent (the executor runs it as a list). Every historical `{query}` row
 * stays a search — this is what keeps old transcripts rendering.
 */
export function ragSearchListingKind(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const kind = typeof input.kind === 'string' ? input.kind : undefined;
  if (input.action === 'list') return kind ?? 'generic';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (input.action === undefined && query === '' && kind !== undefined) {
    return kind;
  }
  return undefined;
}

/**
 * The humanized title of one tool step — the same voice the 0.3 timeline
 * spoke. The retrieval tools carry exactly one human-meaningful argument
 * each; anything unknown falls back to the generic "Called {tool}".
 */
export function stepActivityLabel(t: TFunction, step: StepActivity): string {
  if (step.tool === 'rag_search') {
    const listedKind = ragSearchListingKind(step.input);
    if (listedKind !== undefined) {
      return t(LISTING_LABEL_KEYS[listedKind] ?? 'thinking.listing.generic');
    }
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
  // A task ref is org state, not a citation, so it reads as work rather than
  // as a document. Checked before the document branch because both arrive on
  // `rag_fetch` and only the prefix distinguishes them.
  if (step.tool === 'rag_fetch' && step.detail?.startsWith('task:') === true) {
    return t('thinking.readingTask', {
      name: step.resultName ?? step.detail.slice('task:'.length),
    });
  }
  if (step.tool === 'rag_fetch') {
    return t('thinking.readingDocument', {
      name: step.resultName ?? step.detail ?? step.tool,
    });
  }
  return t('parts.toolCall', { tool: step.tool });
}
