import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import { getPublicHttpApiUrl } from '../../lib/helpers/public_storage_url';

/** Public SP entityID + ACS URL, derived from SITE_URL (stable, paste into IdP). */
export function samlEndpoints(): { spEntityId: string; acsUrl: string } {
  const base = getPublicHttpApiUrl();
  return {
    spEntityId: `${base}/api/sso/saml/metadata`,
    acsUrl: `${base}/api/sso/saml/acs`,
  };
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
    const { spEntityId, acsUrl } = samlEndpoints();
    const wantSigned = config?.wantAssertionsSigned ?? true;

    const keyDescriptor = config?.spCertificate
      ? `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${pemToBase64(
          config.spCertificate,
        )}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>`
      : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${spEntityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="${wantSigned}" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    ${keyDescriptor}
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="0" isDefault="true"/>
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
