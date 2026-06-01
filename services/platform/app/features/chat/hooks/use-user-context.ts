import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface UserContext {
  timezone: string;
  /** Browser locale (`navigator.language`). */
  language: string;
  /** App UI locale chosen in the language switcher (i18n). Preferred over the
   * browser locale as the response-language fallback when the user's input
   * language is unclear. */
  uiLanguage: string;
}

/**
 * Provides user environment context (timezone, browser + UI language)
 * for passing to the AI agent as template variables.
 *
 * Geolocation is handled on-demand via the request_user_location tool.
 */
export function useUserContext(): UserContext {
  const { i18n } = useTranslation();
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const language = useMemo(() => navigator.language, []);
  const uiLanguage = i18n.language;

  return useMemo(
    () => ({
      timezone,
      language,
      uiLanguage,
    }),
    [timezone, language, uiLanguage],
  );
}
