export function isValidLocale(locale: string) {
  try {
    const localeObj = new Intl.Locale(locale);
    return Boolean(localeObj.language);
  } catch (e) {
    console.error(e);
    return false;
  }
}
