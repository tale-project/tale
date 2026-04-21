import type { ChatFilterCategory } from '../../../lib/shared/schemas/governance';

/**
 * Empty skeleton categories shipped as defaults. Each admin gets these three
 * preset buckets to fill — we don't ship curated slur lists (cultural /
 * locale / industry variance is too high for a vendor to opinionate on).
 *
 * All three default to `enabled: false` + empty words/patterns so the
 * platform never appears to "take a position" on any single word list
 * while still giving admins a structured place to add rules.
 *
 * `label` values are placeholder English strings; the UI resolves user-visible
 * labels through `chatFilter.defaults.{id}` i18n keys.
 */
export const DEFAULT_CHAT_FILTER_CATEGORIES: readonly ChatFilterCategory[] = [
  {
    id: 'hate_speech',
    label: 'Hate speech',
    enabled: false,
    mode: 'block',
    words: [],
    patterns: [],
  },
  {
    id: 'profanity',
    label: 'Profanity',
    enabled: false,
    mode: 'mask',
    words: [],
    patterns: [],
  },
  {
    id: 'violence',
    label: 'Violence',
    enabled: false,
    mode: 'flag',
    words: [],
    patterns: [],
  },
];
