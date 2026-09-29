export function isValidLocale(locale: string): boolean {
  try {
    const localeObj = new Intl.Locale(locale);
    return Boolean(localeObj.language);
  } catch (err) {
    // A tag the browser or the Accept-Language header offers is input, not a
    // fault: callers fall back to the next candidate, so this is a warning.
    console.warn('Invalid locale tag:', locale, err);
    return false;
  }
}
