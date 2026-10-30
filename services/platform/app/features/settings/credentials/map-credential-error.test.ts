import { afterEach, describe, expect, it } from 'vitest';

import { runAdapted } from '@/app/lib/backend/adapters';
import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

import {
  credentialFailureDetail,
  mapCredentialError,
} from './map-credential-error';

/** What an adapted call rejects with for a door's non-2xx answer. */
function answered(status: number, body: unknown): Promise<unknown> {
  return runAdapted(() =>
    Promise.reject(backendApiErrorFromBody(status, body)),
  ).catch((error: unknown) => error);
}

const settings = (key: string) => i18n.t(key, { ns: 'settings' });
const generic = () => i18n.t('errors.generic', { ns: 'common' });

/** The provider door's own words for a taken name — English, for API
 * clients (`backend/domains/provider_credentials/service.ts`). */
const NAME_TAKEN_SENTENCE =
  'A credential named "Production" already exists for this provider — pick a different name.';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

// #4831: the credential surfaces showed the server's English sentence in
// every locale, and an English literal for a fault.
describe('mapCredentialError', () => {
  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    it('words a coded refusal in the reader language, not the server sentence', async () => {
      await i18n.changeLanguage(locale);
      const refusal = await answered(409, {
        error: 'CREDENTIAL_NAME_TAKEN',
        message: NAME_TAKEN_SENTENCE,
      });

      const shown = mapCredentialError(refusal);
      expect(shown).toBe(settings('credentials.errors.nameTaken'));
      expect(shown).not.toContain('pick a different name');
      if (locale !== 'en') {
        expect(shown).not.toBe(
          i18n.t('credentials.errors.nameTaken', { ns: 'settings', lng: 'en' }),
        );
      }
    });

    it('says something went wrong for a 500, never the server text', async () => {
      await i18n.changeLanguage(locale);
      const fault = await answered(500, {
        error: 'INTERNAL',
        message: 'relation "app.provider_credentials" does not exist',
      });

      expect(mapCredentialError(fault)).toBe(generic());
      expect(credentialFailureDetail(fault)).toBeUndefined();
    });

    it('says the connection was lost when the request got no answer', async () => {
      await i18n.changeLanguage(locale);
      const lost = new TypeError('Failed to fetch');

      expect(mapCredentialError(lost)).toBe(
        i18n.t('errors.connectionLost', { ns: 'common' }),
      );
      expect(mapCredentialError(lost)).not.toContain('Failed to fetch');
    });

    it('reads a lapsed session as the session-ended sentence', async () => {
      await i18n.changeLanguage(locale);
      const refusal: unknown = await lapsedSessionRefusal().catch(
        (error: unknown) => error,
      );
      expect(mapCredentialError(refusal)).toBe(SESSION_ENDED[locale]);
    });
  });

  it.each([
    ['CREDENTIAL_NAME_INVALID', 'credentials.errors.nameInvalid'],
    ['CREDENTIAL_NOT_FOUND', 'credentials.deletedInAnotherSession'],
    ['CREDENTIAL_DISABLED_DEFAULT', 'credentials.errors.disabledDefault'],
    ['CREDENTIAL_DISABLED', 'credentials.errors.disabledDefault'],
    ['CREDENTIAL_DEFAULT_CONFLICT', 'credentials.errors.defaultConflict'],
    ['CREDENTIAL_PATCH_EMPTY', 'credentials.errors.nothingChanged'],
    ['FORBIDDEN_DEVELOPER_SETTINGS', 'credentials.errors.forbidden'],
    ['FORBIDDEN', 'credentials.errors.forbidden'],
  ])('words %s as %s', async (code, key) => {
    const refusal = await answered(409, {
      error: code,
      message: 'An English sentence for API clients.',
    });
    expect(mapCredentialError(refusal)).toBe(settings(key));
  });

  it('reads an insert that wrote nothing as a fault, not a refusal', async () => {
    const refusal = await answered(400, {
      error: 'CREDENTIAL_CREATE_FAILED',
      message: 'Insert failed',
    });
    expect(mapCredentialError(refusal)).toBe(generic());
  });

  // A code this list does not know keeps the words its handler wrote: the
  // app's rule for a refusal (`failureDetail`).
  it('keeps the words of a refusal whose code it does not know', async () => {
    const refusal = await answered(400, {
      error: 'CREDENTIAL_CONFIG_REQUIRED',
      message: 'Connector "Outlook" needs "Mailbox".',
    });
    expect(mapCredentialError(refusal)).toBe(
      'Connector "Outlook" needs "Mailbox".',
    );
  });

  it('never shows a runtime error or a stray payload', () => {
    expect(
      mapCredentialError(
        new TypeError("Cannot read properties of undefined (reading 'map')"),
      ),
    ).toBe(generic());
    expect(
      mapCredentialError({ data: { message: 'config root missing' } }),
    ).toBe(generic());
  });
});
