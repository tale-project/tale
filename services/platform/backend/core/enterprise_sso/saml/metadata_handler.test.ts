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
    delete process.env.ADDITIONAL_SITE_URLS;
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

  it('advertises one ACS per configured site origin, canonical first', async () => {
    // A browser signs in on the domain it is on and the IdP must post the
    // assertion back to THAT domain's ACS — so every configured origin needs
    // its own AssertionConsumerService in the metadata the admin imports.
    process.env.ADDITIONAL_SITE_URLS = 'https://tale.partner.example';
    try {
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
      const locations = [
        ...xml.matchAll(/<AssertionConsumerService[^>]*Location="([^"]+)"/g),
      ].map((m) => m[1]);
      expect(locations).toEqual([
        'https://app.example.com/http_api/api/sso/saml/acs',
        'https://tale.partner.example/http_api/api/sso/saml/acs',
      ]);
      // Exactly one default, and it is the canonical domain.
      expect(xml.match(/isDefault="true"/g)).toHaveLength(1);
      expect(xml).toContain(
        'Location="https://app.example.com/http_api/api/sso/saml/acs" index="0" isDefault="true"',
      );
      // The SP entityID stays ONE stable value — the IdP knows the SP by it.
      expect(
        xml.match(/entityID="https:\/\/app\.example\.com[^"]*"/g),
      ).toHaveLength(1);
      expect(xml).not.toContain('entityID="https://tale.partner.example');
    } finally {
      delete process.env.ADDITIONAL_SITE_URLS;
    }
  });

  it('advertises exactly one ACS on a single-domain deployment', async () => {
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
    expect(xml.match(/<AssertionConsumerService/g)).toHaveLength(1);
    expect(xml).toContain(
      'Location="https://app.example.com/http_api/api/sso/saml/acs" index="0" isDefault="true"',
    );
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
