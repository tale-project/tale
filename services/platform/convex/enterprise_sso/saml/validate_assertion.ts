'use node';

import { SAML, type SamlConfig } from '@node-saml/node-saml';
import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';

/**
 * SAML 2.0 assertion handling, isolated in a Node action (node-saml needs
 * node:crypto / xml-crypto). The V8 ACS handler resolves + decrypts config from
 * the DB, calls in here to verify the signed/encrypted assertion, and gets back
 * a normalized identity. Keeps the node/V8 bundling boundary clean (see the
 * `convex` skill): file I/O and Node-only libs live here, plain data crosses out.
 */

function buildSaml(args: {
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  acsUrl: string;
  spPrivateKey?: string;
  wantAssertionsSigned?: boolean;
}): SAML {
  const config: SamlConfig = {
    issuer: args.spEntityId,
    callbackUrl: args.acsUrl,
    entryPoint: args.idpSsoUrl,
    idpCert: args.idpCertificate,
    audience: args.spEntityId,
    wantAssertionsSigned: args.wantAssertionsSigned ?? true,
    wantAuthnResponseSigned: false,
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
 * the plain body {@link validateSamlResponse} wraps (reused by 0.5). */
export async function validateSamlResponseImpl(
  args: ValidateSamlResponseArgs,
): Promise<{
  ok: boolean;
  error?: string;
  nameId?: string;
  attributes?: Record<string, unknown>;
}> {
  try {
    const saml = buildSaml(args);
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

export const validateSamlResponse = internalAction({
  args: {
    samlResponse: v.string(),
    relayState: v.optional(v.string()),
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
    spEntityId: v.string(),
    acsUrl: v.string(),
    spPrivateKey: v.optional(v.string()),
    wantAssertionsSigned: v.optional(v.boolean()),
  },
  returns: v.object({
    ok: v.boolean(),
    error: v.optional(v.string()),
    nameId: v.optional(v.string()),
    attributes: v.optional(v.record(v.string(), v.any())),
  }),
  handler: async (_ctx, args) => validateSamlResponseImpl(args),
});

export interface BuildSamlAuthnRedirectArgs {
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  acsUrl: string;
  relayState: string;
}

/** Build the SP-initiated AuthnRequest redirect URL (Redirect binding) —
 * the plain body {@link buildSamlAuthnRedirect} wraps (reused by 0.5). */
export async function buildSamlAuthnRedirectImpl(
  args: BuildSamlAuthnRedirectArgs,
): Promise<{ url?: string; error?: string }> {
  try {
    const saml = buildSaml(args);
    const url = await saml.getAuthorizeUrlAsync(args.relayState, undefined, {});
    return { url };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Failed to build request',
    };
  }
}

export const buildSamlAuthnRedirect = internalAction({
  args: {
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
    spEntityId: v.string(),
    acsUrl: v.string(),
    relayState: v.string(),
  },
  returns: v.object({
    url: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => buildSamlAuthnRedirectImpl(args),
});
