'use node';

import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type SamlConfig,
} from '@node-saml/node-saml';

/**
 * SAML 2.0 assertion handling, isolated in a Node action (node-saml needs
 * node:crypto / xml-crypto). The V8 ACS handler resolves + decrypts config from
 * the DB, calls in here to verify the signed/encrypted assertion, and gets back
 * a normalized identity. Keeps the node/V8 bundling boundary clean (see the
 * `convex` skill): file I/O and Node-only libs live here, plain data crosses out.
 */

export interface SamlValidationDeps {
  /**
   * Shared store of the AuthnRequest IDs this deployment issued — MUST span
   * instances (the response can land on a different container than the one
   * that built the request). The runtime injects the PG-backed provider
   * (`domains/sso/saml-request-cache.ts`); tests inject fakes.
   */
  cacheProvider: CacheProvider;
}

function buildSaml(
  args: {
    idpSsoUrl: string;
    idpCertificate: string;
    spEntityId: string;
    acsUrl: string;
    spPrivateKey?: string;
    wantAssertionsSigned?: boolean;
  },
  deps: SamlValidationDeps,
): SAML {
  const config: SamlConfig = {
    issuer: args.spEntityId,
    callbackUrl: args.acsUrl,
    entryPoint: args.idpSsoUrl,
    idpCert: args.idpCertificate,
    audience: args.spEntityId,
    wantAssertionsSigned: args.wantAssertionsSigned ?? true,
    wantAuthnResponseSigned: false,
    // Replay protection. An SP-initiated response must answer an
    // AuthnRequest this deployment actually issued (getAuthorizeUrlAsync
    // saves the generated ID into the cacheProvider), and only ONCE —
    // node-saml deletes the ID after a successful validation. `ifPresent`
    // (not `always`) keeps IdP-initiated posts working: they carry no
    // InResponseTo by design, and their replay window stays bounded by the
    // assertion's NotBefore/NotOnOrAfter, which node-saml enforces.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    cacheProvider: deps.cacheProvider,
    ...(args.spPrivateKey
      ? { decryptionPvk: args.spPrivateKey, privateKey: args.spPrivateKey }
      : {}),
  };
  return new SAML(config);
}

function toAttributeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) out[key] = val;
  return out;
}

export interface ValidateSamlResponseArgs {
  samlResponse: string;
  relayState?: string;
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  acsUrl: string;
  spPrivateKey?: string;
  wantAssertionsSigned?: boolean;
}

/** Verify a SAMLResponse (POST binding) and return the normalized identity —
 * the plain body {@link validateSamlResponse} wraps (reused by 0.5). A
 * present InResponseTo must match an unconsumed issued-request ID in
 * `deps.cacheProvider` (consumed on success — one-time use). */
export async function validateSamlResponseImpl(
  args: ValidateSamlResponseArgs,
  deps: SamlValidationDeps,
): Promise<{
  ok: boolean;
  error?: string;
  nameId?: string;
  attributes?: Record<string, unknown>;
}> {
  try {
    const saml = buildSaml(args, deps);
    const { profile } = await saml.validatePostResponseAsync({
      SAMLResponse: args.samlResponse,
      ...(args.relayState ? { RelayState: args.relayState } : {}),
    });
    if (!profile) return { ok: false, error: 'No SAML profile returned' };
    const nameId =
      typeof profile.nameID === 'string' ? profile.nameID : undefined;
    // node-saml exposes the asserted attributes on `profile.attributes`.
    const attributes = toAttributeRecord(profile.attributes);
    return { ok: true, nameId, attributes };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'SAML validation failed',
    };
  }
}
export interface BuildSamlAuthnRedirectArgs {
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  acsUrl: string;
  relayState: string;
}

/** Build the SP-initiated AuthnRequest redirect URL (Redirect binding) —
 * the plain body {@link buildSamlAuthnRedirect} wraps (reused by 0.5). The
 * generated request ID is saved into `deps.cacheProvider` so the ACS can
 * validate the response's InResponseTo against it. */
export async function buildSamlAuthnRedirectImpl(
  args: BuildSamlAuthnRedirectArgs,
  deps: SamlValidationDeps,
): Promise<{ url?: string; error?: string }> {
  try {
    const saml = buildSaml(args, deps);
    const url = await saml.getAuthorizeUrlAsync(args.relayState, undefined, {});
    return { url };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to build request',
    };
  }
}
