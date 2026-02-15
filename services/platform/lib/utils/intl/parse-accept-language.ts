interface LanguageEntry {
  locale: string;
  quality: number;
}

/**
 * Parses an Accept-Language header string into locale tags sorted by quality weight.
 *
 * @example
 * parseAcceptLanguage('en-US,en;q=0.9,de;q=0.8')
 * // => ['en-US', 'en', 'de']
 *
 * parseAcceptLanguage('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7')
 * // => ['de-DE', 'de', 'en-US', 'en']
 */
export function parseAcceptLanguage(header: string): string[] {
  if (!header) return [];

  const entries: LanguageEntry[] = [];

  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [locale, ...params] = trimmed.split(';');
    const tag = locale.trim();
    if (!tag || tag === '*') continue;

    let quality = 1;
    for (const param of params) {
      const match = param.trim().match(/^q\s*=\s*(\d+(?:\.\d+)?)$/);
      if (match) {
        quality = Math.min(1, Math.max(0, Number(match[1])));
        break;
      }
    }

    entries.push({ locale: tag, quality });
  }

  entries.sort((a, b) => b.quality - a.quality);

  return entries.map((e) => e.locale);
}
