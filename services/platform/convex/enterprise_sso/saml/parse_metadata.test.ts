import { describe, expect, it } from 'vitest';

import {
  MAX_SAML_METADATA_BYTES,
  parseSamlMetadataXml,
} from './parse_metadata';

const CERT_BODY =
  'MIIC8DCCAdigAwIBAgIQdzA5Lo2xR6FKO7lm4A0B2jANBgkqhkiG9w0BAQsFADA0MTIwMAYDVQQD'.repeat(
    12,
  );

/** Entra-style metadata: `md:`-namespaced, signing + encryption keys, both
 * Redirect and POST bindings. */
function entraMetadata({
  entityId = 'https://sts.windows.net/tenant-123/',
  redirectUrl = 'https://login.microsoftonline.com/tenant-123/saml2',
  postUrl = 'https://login.microsoftonline.com/tenant-123/saml2-post',
}: {
  entityId?: string;
  redirectUrl?: string;
  postUrl?: string;
} = {}): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="encryption">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data><X509Certificate>ENCRYPTIONCERTBODY</X509Certificate></X509Data>
      </KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data><X509Certificate>
          ${CERT_BODY}
        </X509Certificate></X509Data>
      </KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${postUrl}"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${redirectUrl}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;
}

describe('parseSamlMetadataXml', () => {
  it('extracts entity ID, Redirect-binding SSO URL, and the signing cert as PEM', () => {
    const result = parseSamlMetadataXml(entraMetadata());
    expect(result).toMatchObject({
      ok: true,
      idpEntityId: 'https://sts.windows.net/tenant-123/',
      // Redirect binding preferred over POST even though POST is listed first.
      idpSsoUrl: 'https://login.microsoftonline.com/tenant-123/saml2',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.idpCertificate).toMatch(
      /^-----BEGIN CERTIFICATE-----\n[\sA-Za-z0-9+/=]+\n-----END CERTIFICATE-----$/,
    );
    // Whitespace inside the metadata's cert body is stripped, not preserved.
    expect(result.idpCertificate).not.toMatch(/ {2}/);
    // The encryption-only certificate must never be picked.
    expect(result.idpCertificate).not.toContain('ENCRYPTIONCERTBODY');
  });

  it('parses unprefixed metadata (Keycloak-style, no md: namespace prefix)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://kc.example.com/realms/acme">
  <IDPSSODescriptor>
    <KeyDescriptor>
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data><X509Certificate>${CERT_BODY}</X509Certificate></X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://kc.example.com/realms/acme/protocol/saml"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
    const result = parseSamlMetadataXml(xml);
    expect(result).toMatchObject({
      ok: true,
      idpEntityId: 'https://kc.example.com/realms/acme',
      // Only a POST binding published → fall back to it.
      idpSsoUrl: 'https://kc.example.com/realms/acme/protocol/saml',
    });
  });

  it('unwraps an EntitiesDescriptor container and skips non-IdP entities', () => {
    const xml = `<EntitiesDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata">
  <EntityDescriptor entityID="https://sp.example.com"><SPSSODescriptor/></EntityDescriptor>
  ${entraMetadata().replace(/^<\?xml[^>]*\?>\n/, '')}
</EntitiesDescriptor>`;
    const result = parseSamlMetadataXml(xml);
    expect(result).toMatchObject({
      ok: true,
      idpEntityId: 'https://sts.windows.net/tenant-123/',
    });
  });

  it('rejects SP metadata (no IDPSSODescriptor) with not_idp', () => {
    const xml = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://sp.example.com">
  <SPSSODescriptor AuthnRequestsSigned="false"/>
</EntityDescriptor>`;
    expect(parseSamlMetadataXml(xml)).toEqual({ ok: false, error: 'not_idp' });
  });

  it('rejects malformed XML and non-metadata documents with invalid', () => {
    expect(parseSamlMetadataXml('<EntityDescriptor')).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(parseSamlMetadataXml('{"not":"xml"}')).toEqual({
      ok: false,
      error: 'invalid',
    });
  });

  it('rejects metadata missing the SSO endpoint or certificate with incomplete', () => {
    const noCert = `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com">
  <IDPSSODescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.com/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`;
    expect(parseSamlMetadataXml(noCert)).toEqual({
      ok: false,
      error: 'incomplete',
    });
  });

  it('rejects oversized documents before parsing', () => {
    const oversized = `<a>${'x'.repeat(MAX_SAML_METADATA_BYTES)}</a>`;
    expect(parseSamlMetadataXml(oversized)).toEqual({
      ok: false,
      error: 'too_large',
    });
  });
});
