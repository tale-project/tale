import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../lib/ctx';
import { samlMetadataHandler } from './metadata_handler';

const SP_CERT =
  '-----BEGIN CERTIFICATE-----\nMIIBspcertbody\nMIIBsecondline\n-----END CERTIFICATE-----\n';

function ctxWith(config: unknown): ActionCtx {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler reads only runQuery
  return {
    runQuery: vi.fn().mockResolvedValue(config),
    runAction: vi.fn(),
  } as unknown as ActionCtx;
}

const request = new Request(
  'http://backend-api:3005/api/sso/saml/metadata?org=org-1',
);

/**
 * The SP certificate is what the ACS DECRYPTS assertions with, so the
 * metadata must advertise it as an encryption key: an IdP that imports SP
 * metadata (Keycloak, ADFS, Shibboleth) encrypts only to a
 * `use="encryption"` descriptor — with a signing-only one it never encrypts,
 * and a connection that requires encrypted assertions refuses every login.
 */
describe('samlMetadataHandler — SP KeyDescriptor', () => {
  beforeEach(() => {
    process.env.SITE_URL = 'https://app.example.com';
    delete process.env.BASE_PATH;
  });

  afterEach(() => {
    delete process.env.SITE_URL;
  });

  it('advertises the SP certificate for both signing and encryption', async () => {
    const res = await samlMetadataHandler(
      ctxWith({
        organizationId: 'org-1',
        idpEntityId: 'https://idp.example.com/entity',
        idpSsoUrl: 'https://idp.example.com/sso',
        idpCertificate: 'unused',
        spCertificate: SP_CERT,
        wantAssertionsSigned: true,
      }),
      request,
    );

    expect(res.status).toBe(200);
    const xml = await res.text();
    const descriptors = xml.match(/<KeyDescriptor use="([a-z]+)">/g) ?? [];
    expect(descriptors).toEqual([
      '<KeyDescriptor use="signing">',
      '<KeyDescriptor use="encryption">',
    ]);
    // Both carry the same certificate, base64 body only.
    const certs = xml.match(/<X509Certificate>([^<]+)<\/X509Certificate>/g);
    expect(certs).toEqual([
      '<X509Certificate>MIIBspcertbodyMIIBsecondline</X509Certificate>',
      '<X509Certificate>MIIBspcertbodyMIIBsecondline</X509Certificate>',
    ]);
  });

  it('emits no KeyDescriptor when the connection has no SP certificate', async () => {
    const res = await samlMetadataHandler(
      ctxWith({
        organizationId: 'org-1',
        idpEntityId: 'https://idp.example.com/entity',
        idpSsoUrl: 'https://idp.example.com/sso',
        idpCertificate: 'unused',
      }),
      request,
    );

    const xml = await res.text();
    expect(xml).not.toContain('<KeyDescriptor');
    expect(xml).toContain('WantAssertionsSigned="true"');
  });
});
