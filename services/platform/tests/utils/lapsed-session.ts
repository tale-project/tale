import { runAdapted } from '@/app/lib/backend/adapters';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';

/**
 * The session door's answer to a request whose session has ended, as
 * `requireSession` (`backend/auth/session.ts`) sends it: guidance for an API
 * client, in English. `app/lib/auth/session-lapse.test.ts` holds this copy to
 * the real door.
 */
export const LAPSED_SESSION_ANSWER = {
  status: 401,
  body: {
    error:
      'Missing or invalid session — sign in, or send an API key as "Authorization: Bearer <key>" to the REST API under /api/v1',
    code: 'UNAUTHORIZED',
  },
} as const;

/** `common.errors.sessionEnded` as each shipped locale words it — what a
 * person whose session ended reads instead of the door's sentence. */
export const SESSION_ENDED = {
  en: 'Your session has ended. Sign in again.',
  de: 'Deine Sitzung ist beendet. Melde dich erneut an.',
  fr: 'Ta session a pris fin. Reconnecte-toi.',
} as const;

export type ShippedLocale = keyof typeof SESSION_ENDED;

export const SHIPPED_LOCALES: readonly ShippedLocale[] = ['en', 'de', 'fr'];

/**
 * What an adapted call rejects with once the session has ended: the door's
 * answer as the app's fetch seam reads it, normalized the way `runAdapted`
 * normalizes every read and write — the refusal a surface's error handler
 * receives.
 */
export function lapsedSessionRefusal(): Promise<never> {
  return runAdapted(() =>
    Promise.reject(
      backendApiErrorFromBody(
        LAPSED_SESSION_ANSWER.status,
        LAPSED_SESSION_ANSWER.body,
      ),
    ),
  );
}

/**
 * Save `locale` as the person's language, the way the language picker does
 * (`localStorage['user-locale']`); the app shell applies it when it mounts.
 * Call before rendering, and {@link forgetSavedLocale} after the test.
 */
export function saveLocale(locale: ShippedLocale): void {
  localStorage.setItem('user-locale', locale);
}

/** Undo {@link saveLocale}: forget the saved language and put the app's
 * i18n back in English, so the next test's first paint is not in the last
 * test's language. */
export async function forgetSavedLocale(): Promise<void> {
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
}
