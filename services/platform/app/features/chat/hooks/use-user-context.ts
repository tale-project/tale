import { useMemo } from 'react';

export interface UserContext {
  timezone: string;
  language: string;
}

/**
 * Provides user environment context (timezone, language)
 * for passing to the AI agent as template variables.
 *
 * Geolocation is handled on-demand via the request_user_location tool.
 */
export function useUserContext(): UserContext {
  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const language = useMemo(() => navigator.language, []);

  return useMemo(
    () => ({
      timezone,
      language,
    }),
    [timezone, language],
  );
}
