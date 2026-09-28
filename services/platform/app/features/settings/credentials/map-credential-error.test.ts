import { describe, expect, it } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  lapsedSessionRefusal,
} from '@/tests/utils/lapsed-session';

import {
  isOpaqueServerErrorMessage,
  mapCredentialError,
} from './map-credential-error';

describe('isOpaqueServerErrorMessage', () => {
  it('flags Convex action dumps', () => {
    expect(
      isOpaqueServerErrorMessage(
        "[CONVEX A(lib/providers/catalog_actions:listProviderCatalogs)] [Request ID: abc] Server Error Cannot find module '/var/folders/x/T/tmp/modules/lib/providers/catalog_actions.js' Called by client",
      ),
    ).toBe(true);
  });

  it('allows short product sentences', () => {
    expect(isOpaqueServerErrorMessage('catalog root missing')).toBe(false);
  });
});

describe('mapCredentialError', () => {
  it('returns structured AppError messages', () => {
    expect(
      mapCredentialError({ data: { message: 'Name already taken' } }),
    ).toBe('Name already taken');
  });

  it('replaces opaque Error.message dumps with a reload hint', () => {
    expect(
      mapCredentialError(
        new Error(
          "[CONVEX A(lib/providers/harness_status:listHarnessStatus)] [Request ID: d508] Server Error Cannot find module '/var/folders/r5/tmp/modules/lib/providers/harness_status.js' Called by client",
        ),
      ),
    ).toBe('Something went wrong. Reload and try again.');
  });
});

// A credential refusal is shown verbatim; a lapsed session's is the app's
// own sentence, in the admin's language.
describe('mapCredentialError after a lapsed session', () => {
  it.each(SHIPPED_LOCALES)(
    'reads as the session-ended sentence (%s)',
    async (locale) => {
      await i18n.changeLanguage(locale);
      const refusal: unknown = await lapsedSessionRefusal().catch(
        (error: unknown) => error,
      );
      expect(mapCredentialError(refusal)).toBe(SESSION_ENDED[locale]);
      await i18n.changeLanguage('en');
    },
  );
});
