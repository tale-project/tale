/**
 * The English display name of a BCP 47 language tag — `de` → `German`,
 * `en-GB` → `British English` — for prose the model reads. A directive that
 * names the language in words lands where the raw tag reads as an
 * abbreviation a reasoning model weights weakly; callers keep the tag
 * beside the name, so a tag the runtime cannot name still says what it is.
 *
 * `Intl.DisplayNames` with `fallback: 'code'` answers a well-formed tag it
 * has no name for (`xx`) with the tag itself; a tag it cannot parse at all
 * throws, and that is answered with the tag unchanged — never an exception
 * on the prompt path.
 *
 * Sibling of `narrow-bcp47.ts`: platform-side only, no DOM, no i18n catalog.
 */
export function languageDisplayName(tag: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language', fallback: 'code' }).of(
        tag,
      ) ?? tag
    );
  } catch (error) {
    console.warn(
      `[language-name] no display name for ${JSON.stringify(tag)}: ${error instanceof Error ? error.message : 'unknown'}`,
    );
    return tag;
  }
}
