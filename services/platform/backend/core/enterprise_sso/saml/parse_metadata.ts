'use node';
import { XMLParser } from 'fast-xml-parser';

import { safeFetch, SafeFetchError } from '../../../../lib/net/safe-fetch';

/**
 * SAML 2.0 federation-metadata ingestion (issue #2652). Every IdP (Entra,
 * Okta, Keycloak, ADFS, …) publishes the three values our SAML form asks for —
 * entity ID, SSO URL, signing certificate — in a standard metadata XML
 * document. This module parses that document so admins never hand-copy a
 * certificate again.
 *
 * `'use node'` keeps fast-xml-parser on the node side with the other SAML
 * machinery (validate_assertion.ts); the admin-gated public action in
 * `config/actions.ts` delegates here. The metadata is attacker-controllable
 * input (URL fetch or upload), so it crosses two guards: `safeFetch` (SSRF —
 * private ranges, redirects, size cap) and the byte cap below (fast-xml-parser
 * ≥4.2.4 additionally bounds DOCTYPE entity expansion).
 */

/** Upper bound for a metadata document. Real federation metadata is a few KB
 * (Entra's runs ~30 KB with three certificates); 1 MB is generous. */
export const MAX_SAML_METADATA_BYTES = 1_048_576;

export type ParsedSamlMetadata =
  | {
      ok: true;
      idpEntityId: string;
      idpSsoUrl: string;
      idpCertificate: string;
    }
  | {
      ok: false;
      /** Stable error kind the UI maps to a localized message. */
      error: 'too_large' | 'invalid' | 'not_idp' | 'incomplete';
    };

/** Coerce a fast-xml-parser node that may be a single object or an array. */
function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringProp(node: unknown, key: string): string | undefined {
  if (!isRecord(node)) return undefined;
  const value = node[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Re-wrap a base64 certificate body as PEM (64-char lines) — the format the
 * form's certificate textarea documents and node-saml accepts. */
function toPemCertificate(base64Body: string): string {
  const compact = base64Body.replace(/\s+/g, '');
  const lines = compact.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
}

const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';
const POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';

/** Pick the SSO endpoint: prefer the Redirect binding (what our SP-initiated
 * login uses — see buildSamlAuthnRedirect), then POST, then any Location. */
function pickSsoUrl(services: unknown[]): string | undefined {
  for (const binding of [REDIRECT_BINDING, POST_BINDING]) {
    for (const svc of services) {
      if (stringProp(svc, '@_Binding') === binding) {
        const location = stringProp(svc, '@_Location');
        if (location) return location;
      }
    }
  }
  for (const svc of services) {
    const location = stringProp(svc, '@_Location');
    if (location) return location;
  }
  return undefined;
}

/** Pick the signing certificate: prefer KeyDescriptors marked use="signing",
 * then ones with no `use` attribute (which covers both), never "encryption". */
function pickSigningCertificate(keyDescriptors: unknown[]): string | undefined {
  const byPreference = [
    ...keyDescriptors.filter((k) => stringProp(k, '@_use') === 'signing'),
    ...keyDescriptors.filter((k) => stringProp(k, '@_use') === undefined),
  ];
  for (const descriptor of byPreference) {
    if (!isRecord(descriptor)) continue;
    const keyInfo = descriptor.KeyInfo;
    if (!isRecord(keyInfo)) continue;
    for (const x509Data of asArray(keyInfo.X509Data)) {
      if (!isRecord(x509Data)) continue;
      for (const cert of asArray(x509Data.X509Certificate)) {
        if (typeof cert === 'string' && cert.trim().length > 0) {
          return toPemCertificate(cert);
        }
      }
    }
  }
  return undefined;
}

/**
 * Parse a federation-metadata XML document into the three IdP-side fields the
 * SAML form needs. Returns a typed error instead of throwing so the action can
 * map each kind to a localized message.
 */
export function parseSamlMetadataXml(xml: string): ParsedSamlMetadata {
  if (new TextEncoder().encode(xml).byteLength > MAX_SAML_METADATA_BYTES) {
    return { ok: false, error: 'too_large' };
  }

  let parsed: unknown;
  try {
    // `removeNSPrefix` normalizes `md:EntityDescriptor` vs unprefixed forms —
    // both are common in the wild (Entra prefixes, Keycloak doesn't).
    parsed = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
    }).parse(xml);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (!isRecord(parsed)) return { ok: false, error: 'invalid' };

  // Some IdPs wrap the entity in an `EntitiesDescriptor` container; take the
  // first entity that carries an IDPSSODescriptor.
  const container = isRecord(parsed.EntitiesDescriptor)
    ? parsed.EntitiesDescriptor
    : parsed;
  const entities = asArray(container.EntityDescriptor);
  if (entities.length === 0) return { ok: false, error: 'invalid' };

  const entity = entities.find(
    (e) => isRecord(e) && e.IDPSSODescriptor !== undefined,
  );
  // Well-formed metadata without an IdP role descriptor — e.g. an SP metadata
  // file uploaded by mistake. Distinct error so the message can say so.
  if (!isRecord(entity)) return { ok: false, error: 'not_idp' };

  const idpEntityId = stringProp(entity, '@_entityID');
  const idpDescriptors = asArray(entity.IDPSSODescriptor);
  const idp = idpDescriptors.find(isRecord);
  if (!idp) return { ok: false, error: 'not_idp' };

  const idpSsoUrl = pickSsoUrl(asArray(idp.SingleSignOnService));
  const idpCertificate = pickSigningCertificate(asArray(idp.KeyDescriptor));

  if (!idpEntityId || !idpSsoUrl || !idpCertificate) {
    return { ok: false, error: 'incomplete' };
  }
  return { ok: true, idpEntityId, idpSsoUrl, idpCertificate };
}

/**
 * Fetch (optionally) + parse IdP federation metadata. Exactly one of `url` /
 * `xml` is provided by the caller (the admin-gated public action validates
 * that). URL fetches go through `safeFetch` — SSRF guard + the same size cap.
 */
export async function fetchAndParseIdpMetadataImpl(args: {
  url?: string;
  xml?: string;
}): Promise<{
  ok: boolean;
  error?: string;
  idpEntityId?: string;
  idpSsoUrl?: string;
  idpCertificate?: string;
}> {
  let xml = args.xml;
  if (args.url !== undefined) {
    try {
      const response = await safeFetch(args.url, {
        maxResponseBytes: MAX_SAML_METADATA_BYTES,
        headers: { accept: 'application/samlmetadata+xml, text/xml, */*' },
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, error: 'fetch_failed' };
      }
      xml = response.body;
    } catch (error) {
      console.warn('[sso] metadata fetch failed', error);
      if (
        error instanceof SafeFetchError &&
        error.kind === 'response_too_large'
      ) {
        return { ok: false, error: 'too_large' };
      }
      return { ok: false, error: 'fetch_failed' };
    }
  }
  if (xml === undefined) return { ok: false, error: 'invalid' };

  const result = parseSamlMetadataXml(xml);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    idpEntityId: result.idpEntityId,
    idpSsoUrl: result.idpSsoUrl,
    idpCertificate: result.idpCertificate,
  };
}
