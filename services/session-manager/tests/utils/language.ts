import { i18n } from '@/lib/i18n/i18n';

type Language = 'en' | 'de' | 'fr';

/**
 * Shows the app in a language, as the language picker does: saved for the app
 * shell, which applies it when it mounts, and set on the instance. Call
 * before rendering, and `resetLanguage` after the test.
 */
export async function showLanguage(language: Language): Promise<void> {
  localStorage.setItem('user-locale', language);
  await i18n.changeLanguage(language);
}

/** Back to English, for the next test's first paint. */
export async function resetLanguage(): Promise<void> {
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
}
