import { narrowBcp47 } from '@/lib/shared/utils/narrow-bcp47';

export type CommentBodyByLocale = Record<string, string>;

/**
 * Pick the viewer-facing comment text from a write-time locale snapshot.
 * Falls back: exact locale → primary language (`de-CH` → `de`) → English → canonical `body`.
 */
export function pickCommentBody(
  body: string,
  bodyByLocale: CommentBodyByLocale | undefined,
  locale: string,
): string {
  if (!bodyByLocale) return body;
  const exact = bodyByLocale[locale];
  if (exact) return exact;
  const base = narrowBcp47(locale);
  if (base) {
    const narrowed = bodyByLocale[base];
    if (narrowed) return narrowed;
  }
  return bodyByLocale.en || body;
}
