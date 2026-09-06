import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  publicHttpApiUrlFor,
  siteOrigins,
} from '../../lib/helpers/public_origin';
import { getPublicHttpApiUrl } from '../../lib/helpers/public_storage_url';

/**
 * Public SP entityID + ACS URL to paste into the IdP. The entityID is ONE
 * stable value derived from the canonical SITE_URL — an IdP knows the SP by
 * it. The ACS URL is per site origin: a multi-domain deployment posts the
 * assertion back to the domain the browser started on (its flow cookie lives
 * there), so `origin` selects that domain's ACS; without it the canonical
 * one is returned.
 */
export function samlEndpoints(origin?: string): {
  spEntityId: string;
  acsUrl: string;
} {
  const canonicalBase = getPublicHttpApiUrl();
  const acsBase = origin ? publicHttpApiUrlFor(origin) : canonicalBase;
  return {
    spEntityId: `${canonicalBase}/api/sso/saml/metadata`,
    acsUrl: `${acsBase}/api/sso/saml/acs`,
  };
}

/**
 * Every ACS URL this deployment answers on, canonical first — one per
 * configured site origin, so the metadata registers each domain's reply URL
 * with the IdP in one import.
 */
export function samlAcsUrls(): string[] {
  const origins = siteOrigins();
  if (origins.length === 0) return [samlEndpoints().acsUrl];
  return origins.map((origin) => samlEndpoints(origin).acsUrl);
}

function pemToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

/**
 * GET /api/sso/saml/metadata — SP metadata XML the admin uploads to their IdP.
 * Public (no secrets); includes the SP signing/encryption cert only when one
 * was configured (for encrypted-assertion support).
 */
export async function samlMetadataHandler(
  ctx: ActionCtx,
  req: Request,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const org = url.searchParams.get('org') ?? undefined;
    const resolved = await ctx.runQuery(
      internal.enterprise_sso.internal_queries.resolveSamlConfig,
      { organizationId: org },
    );
    // SP metadata is org-independent apart from the signing certificate — an
    // ambiguous (multi-org, no `org` param) lookup serves the generic defaults,
    // same as no connection at all.
    const config = resolved === 'ambiguous' ? null : resolved;
    const { spEntityId } = samlEndpoints();
    // One ACS per configured site origin; the canonical one is index 0 and
    // the default an IdP-initiated flow posts to.
    const acsServices = samlAcsUrls()
      .map(
        (acsUrl, index) =>
          `<AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="${index}"${index === 0 ? ' isDefault="true"' : ''}/>`,
      )
      .join('\n    ');
    const wantSigned = config?.wantAssertionsSigned ?? true;

    // The one SP certificate serves both purposes — node-saml signs the
    // AuthnRequest with the matching key and decrypts assertions with it —
    // so it is advertised under BOTH uses. Metadata-driven IdPs (Keycloak,
    // ADFS, Shibboleth) pick the encryption key from a `use="encryption"`
    // descriptor; with a signing-only one they never encrypt, and a
    // connection that requires encrypted assertions refuses every login.
    const keyDescriptor = config?.spCertificate
      ? ['signing', 'encryption']
          .map(
            (use) =>
              `<KeyDescriptor use="${use}"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${pemToBase64(
                config.spCertificate,
              )}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`,
          )
          .join('\n    ')
      : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="${wantSigned}" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    ${keyDescriptor}
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    ${acsServices}
  </SPSSODescriptor>
</EntityDescriptor>`;

    return new Response(xml, {
      status: 200,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  } catch (error) {
    console.error('[SSO] SAML metadata error:', error);
    return new Response(
      'SAML metadata unavailable (SITE_URL not configured?)',
      {
        status: 500,
      },
    );
  }
}
