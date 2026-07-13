import { narrowBcp47 } from '@/lib/shared/utils/narrow-bcp47';

export type CommentBodyByLocale = {
  en: string;
  de: string;
  fr: string;
};

/**
 * Pick the viewer-facing comment text from a write-time locale snapshot.
 * Falls back: exact locale → primary language (`de-CH` → `de`) → canonical `body`.
 */
export function pickCommentBody(
  body: string,
  bodyByLocale: CommentBodyByLocale | undefined,
  locale: string,
): string {
  if (!bodyByLocale) return body;
  const exact = (bodyByLocale as Record<string, string | undefined>)[locale];
  if (exact) return exact;
  const base = narrowBcp47(locale);
  if (base) {
    const narrowed = (bodyByLocale as Record<string, string | undefined>)[base];
    if (narrowed) return narrowed;
  }
  return bodyByLocale.en || body;
}
