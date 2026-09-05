'use node';

import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
  type SamlConfig,
} from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';

import { isRecord } from '../../../../lib/utils/type-utils';

/**
 * SAML 2.0 assertion handling, isolated in a Node action (node-saml needs
 * node:crypto / xml-crypto). The V8 ACS handler resolves + decrypts config from
 * the DB, calls in here to verify the signed/encrypted assertion, and gets back
 * a normalized identity. Keeps the node/V8 bundling boundary clean (see the
 * `convex` skill): file I/O and Node-only libs live here, plain data crosses out.
 */

/** The login-page key a connection that requires encrypted assertions
 * bounces a plaintext one with (audited under its readable reason). */
export const SAML_ASSERTION_NOT_ENCRYPTED_KEY =
  'sso.errors.assertionNotEncrypted';

/**
 * Whether the POSTed Response carries its assertion as an
 * `EncryptedAssertion`. node-saml has no "require encryption" option — it
 * decrypts when it finds one and accepts a plaintext `Assertion` otherwise —
 * so the requirement is enforced here, on the SAME parse node-saml runs:
 * the same library with the same options, direct children of the root by
 * local name (`saml.js`'s `validatePostResponseAsync`), so the gate can never
 * judge a different document than the validator processes. `null` when the
 * document does not parse: there is no assertion to judge, and node-saml
 * fails the response with its own error.
 */
function carriesEncryptedAssertion(samlResponse: string): boolean | null {
  let malformed = false;
  const flag = (): void => {
    malformed = true;
  };
  const doc = new DOMParser({
    locator: {},
    errorHandler: { error: flag, fatalError: flag },
  }).parseFromString(
    Buffer.from(samlResponse, 'base64').toString('utf8'),
    'text/xml',
  );
  const root = doc.documentElement;
  if (malformed || !root || root.localName !== 'Response') return null;
  let encryptedAssertions = 0;
  for (let index = 0; index < root.childNodes.length; index += 1) {
    const node = root.childNodes.item(index);
    if (
      node !== null &&
      'localName' in node &&
      node.localName === 'EncryptedAssertion'
    ) {
      encryptedAssertions += 1;
    }
  }
  return encryptedAssertions > 0;
}

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
    idpEntityId: string;
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
    // node-saml 5.1 applies `idpIssuer` to logout messages only; the
    // assertion's Issuer is checked below on the validated profile.
    idpIssuer: args.idpEntityId,
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

/**
 * The AuthnRequest ID an SP-initiated response answers, from the Response
 * element or — when a forwarder stripped it there — from the signed
 * Subject's confirmation data, which node-saml consults only when the
 * Response-level one is present. Undefined for an IdP-initiated response.
 */
function answeredRequestId(profile: Profile): string | undefined {
  if (typeof profile.inResponseTo === 'string' && profile.inResponseTo !== '') {
    return profile.inResponseTo;
  }
  const assertion = profile.getAssertion?.();
  const root = isRecord(assertion) ? assertion.Assertion : undefined;
  const subject = firstRecord(isRecord(root) ? root.Subject : undefined);
  const confirmation = firstRecord(subject?.SubjectConfirmation);
  const data = firstRecord(confirmation?.SubjectConfirmationData);
  const attributes = isRecord(data) ? data.$ : undefined;
  const id = isRecord(attributes) ? attributes.InResponseTo : undefined;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const first = Array.isArray(value) ? value[0] : undefined;
  return isRecord(first) ? first : undefined;
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
  /** The connection's IdP entity ID — the assertion's Issuer must match. */
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  spEntityId: string;
  acsUrl: string;
  spPrivateKey?: string;
  wantAssertionsSigned?: boolean;
  /** The connection's "require encrypted assertions" setting: a plaintext
   * assertion is refused BEFORE validation when set. */
  wantAssertionsEncrypted?: boolean;
}

/** Verify a SAMLResponse (POST binding) and return the normalized identity —
 * the plain body {@link validateSamlResponse} wraps (reused by 0.5). A
 * present InResponseTo must match an unconsumed issued-request ID in
 * `deps.cacheProvider` (consumed on success — one-time use). A refusal
 * that has its own login-page key carries it as `errorKey`. */
export async function validateSamlResponseImpl(
  args: ValidateSamlResponseArgs,
  deps: SamlValidationDeps,
): Promise<{
  ok: boolean;
  error?: string;
  errorKey?: string;
  nameId?: string;
  attributes?: Record<string, unknown>;
  /** The AuthnRequest ID this response answers — set for SP-initiated
   * responses only, so the ACS knows when to demand the browser binding. */
  inResponseTo?: string;
}> {
  try {
    if (
      args.wantAssertionsEncrypted &&
      carriesEncryptedAssertion(args.samlResponse) === false
    ) {
      return {
        ok: false,
        error:
          'This connection requires encrypted assertions, but the identity provider sent a plaintext assertion',
        errorKey: SAML_ASSERTION_NOT_ENCRYPTED_KEY,
      };
    }
    const saml = buildSaml(args, deps);
    const { profile } = await saml.validatePostResponseAsync({
      SAMLResponse: args.samlResponse,
      ...(args.relayState ? { RelayState: args.relayState } : {}),
    });
    if (!profile) return { ok: false, error: 'No SAML profile returned' };
    // The connection's IdP entity ID is REQUIRED by the admin door and is
    // what the assertion's Issuer must match — a valid signature under a
    // shared or rotated certificate is not enough on its own. node-saml
    // exposes the (decrypted, signature-verified) assertion's Issuer on the
    // profile but compares it to `idpIssuer` only for logout messages.
    if (typeof profile.issuer !== 'string' || profile.issuer === '') {
      return { ok: false, error: 'Missing SAML issuer' };
    }
    if (profile.issuer !== args.idpEntityId) {
      return {
        ok: false,
        error: `Unknown SAML issuer. Expected: ${args.idpEntityId} Received: ${profile.issuer}`,
      };
    }
    const nameId =
      typeof profile.nameID === 'string' ? profile.nameID : undefined;
    // node-saml exposes the asserted attributes on `profile.attributes`.
    const attributes = toAttributeRecord(profile.attributes);
    const inResponseTo = answeredRequestId(profile);
    return {
      ok: true,
      nameId,
      attributes,
      ...(inResponseTo !== undefined ? { inResponseTo } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'SAML validation failed',
    };
  }
}
export interface BuildSamlAuthnRedirectArgs {
  idpEntityId: string;
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
