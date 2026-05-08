type Bundle = Record<string, Record<string, unknown>>;

/** Matches `xx-YY` locale codes only (lowercase language, uppercase region). */
const REGIONAL_TAG = /^[a-z]{2}-[A-Z]{2}$/;

/** Pulls the locale code (`de-CH`) out of `…/messages/de-CH.json`-shaped paths. */
const FILE_LOCALE = /\/([^/]+)\.json$/;

/**
 * Maps the result of `import.meta.glob('messages/*-*.json', { eager: true, import: 'default' })`
 * into a `{ 'de-CH': bundle, ... }` map keyed by locale code, dropping anything
 * that doesn't match the `xx-YY` shape.
 *
 * The glob has to stay at the call site (Vite's transform requires a literal
 * pattern), but every service's regex parsing of the resulting filenames was
 * identical — that's what lives here.
 */
export function collectRegionalBundles(
  modules: Record<string, Bundle>,
): Record<string, Bundle> {
  const out: Record<string, Bundle> = {};
  for (const [path, bundle] of Object.entries(modules)) {
    const match = FILE_LOCALE.exec(path);
    const locale = match?.[1];
    if (!locale || !REGIONAL_TAG.test(locale)) continue;
    out[locale] = bundle;
  }
  return out;
}
