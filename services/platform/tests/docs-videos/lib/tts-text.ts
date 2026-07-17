/**
 * Per-locale pronunciation respelling for the SPOKEN text only. eleven_v3
 * supports no IPA/phoneme tags, so words a locale's voice mis-reads get a
 * phonetic alias here — "Tale" read as German /ˈtaːlə/ or French /tal/ must
 * come out as the English brand /teɪl/ everywhere.
 *
 * Applied exclusively on the way INTO the synthesizer: captions, docs pages,
 * and the episode spec keep the real spelling. Pure module.
 */

import type { Locale } from './episode';

/** word (as authored) → respelling the locale's voice pronounces correctly. */
const PRONUNCIATIONS: Record<Locale, Record<string, string>> = {
  en: {},
  de: {
    // German reading turns the brand into "Tal-e" (valleys); "Tejl" yields
    // the English /teɪl/ MID-SENTENCE, but is unstable sentence-initially
    // (one take rendered /taɪl/) — so German narration never OPENS a
    // sentence with the brand; the storyboard doctrine carries the rule.
    Tale: 'Tejl',
  },
  fr: {
    // French reading yields /tal/; "Teïl" gets the English diphthong.
    Tale: 'Teïl',
  },
};

/** Respell the narration for the synthesizer; the written text stays as-is. */
export function toSpokenText(text: string, locale: Locale): string {
  let spoken = text;
  for (const [word, alias] of Object.entries(PRONUNCIATIONS[locale])) {
    // Unicode-aware word boundary: \b misfires around non-ASCII letters.
    spoken = spoken.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])`, 'gu'),
      alias,
    );
  }
  return spoken;
}
