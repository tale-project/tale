/**
 * The one fold from a name a person types to a slug — an automation's name,
 * an organization's tenant key: Latin letters and digits in kebab case,
 * accents dropped (`Müller AG` → `muller-ag`, `Société Générale` →
 * `societe-generale`, `Größe` → `grosse`), at most `maxLength` characters,
 * never a hyphen at either end. Empty for a name with no Latin letter or
 * digit (`@@@`, `发票提醒`); the caller decides what stands in then. One
 * copy, so `Müller AG` is `muller-ag` wherever it is typed — the
 * organization wizard used to fold on its own and drop every accented
 * letter. Layer A — no imports.
 */
export function latinSlug(input: string, maxLength: number): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replaceAll('ß', 'ss')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/^-+|-+$/g, '');
}
