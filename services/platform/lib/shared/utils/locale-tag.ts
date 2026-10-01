import { z } from 'zod';

/**
 * A BCP 47 language tag as the chat reads it: a language subtag and
 * optional further subtags (`de`, `en-GB`, `zh-Hant`).
 *
 * A send's `locale` is written into the turn's system prompt — the
 * reply-language directive names it, and the hand-over note quotes the
 * interface's controls from its catalog — so every door that takes one
 * holds it to this shape: a tag, never free text in the instructions.
 *
 * Sibling of `narrow-bcp47.ts` and `language-name.ts`.
 */
const LOCALE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** The `locale` field of a chat send, on every door that takes one. */
export const localeTagSchema = z.string().max(20).regex(LOCALE_TAG_PATTERN, {
  message: 'locale must be a BCP 47 language tag such as "de" or "en-GB"',
});
