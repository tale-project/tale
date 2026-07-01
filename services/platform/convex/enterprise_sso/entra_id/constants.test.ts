import { describe, expect, it } from 'vitest';

import {
  ENTRA_ISSUER_HELP,
  EntraIssuerError,
  extractTenantId,
} from './constants';

// A real (opaque) tenant GUID shape — not tied to any specific directory.
const TENANT_GUID = '11111111-2222-3333-4444-555555555555';

describe('extractTenantId', () => {
  describe('resolves a concrete tenant', () => {
    const ok: Array<[string, string, string]> = [
      [
        'documented v2 issuer → tenant GUID',
        `https://login.microsoftonline.com/${TENANT_GUID}/v2.0`,
        TENANT_GUID,
      ],
      [
        'v2 issuer without a trailing /v2.0 path still yields the tenant',
        `https://login.microsoftonline.com/${TENANT_GUID}`,
        TENANT_GUID,
      ],
      [
        'bare Directory (tenant) ID GUID → normalized to that tenant',
        TENANT_GUID,
        TENANT_GUID,
      ],
      [
        'bare GUID without hyphens is accepted',
        '11111111222233334444555555555555',
        '11111111222233334444555555555555',
      ],
      [
        'named onmicrosoft.com tenant is kept as-is',
        'https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0',
        'contoso.onmicrosoft.com',
      ],
    ];
    it.each(ok)('%s', (_label, issuer, expected) => {
      expect(extractTenantId(issuer)).toBe(expected);
    });
  });

  describe('rejects rather than silently degrading to `common`', () => {
    const bad: Array<[string, string]> = [
      [
        'v1 sts.windows.net issuer → clear error, NOT silent common',
        `https://sts.windows.net/${TENANT_GUID}/`,
      ],
      ['empty issuer', ''],
      ['whitespace-only issuer', '   '],
      ['a bare `common` string (the old silent fallback)', 'common'],
      ['a non-Microsoft issuer host', 'https://accounts.google.com'],
      [
        'a login URL with no tenant segment',
        'https://login.microsoftonline.com/',
      ],
      ['junk that is not a URL', 'not-a-url'],
    ];
    it.each(bad)('%s', (_label, issuer) => {
      expect(() => extractTenantId(issuer)).toThrow(EntraIssuerError);
    });

    it('the error message is actionable (names the required issuer form)', () => {
      expect(() =>
        extractTenantId(`https://sts.windows.net/${TENANT_GUID}/`),
      ).toThrow(ENTRA_ISSUER_HELP);
    });

    it('never returns the literal "common" for a bad issuer', () => {
      // Regression: the old implementation returned 'common' here, which a
      // single-tenant app then rejects with an opaque AADSTS error.
      let result: string | undefined;
      try {
        result = extractTenantId('common');
      } catch {
        result = undefined;
      }
      expect(result).not.toBe('common');
    });
  });
});
