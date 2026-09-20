export function isValidLocale(locale: string): boolean {
  try {
    const localeObj = new Intl.Locale(locale);
    return Boolean(localeObj.language);
  } catch (err) {
    console.error(err);
    return false;
  }
}
