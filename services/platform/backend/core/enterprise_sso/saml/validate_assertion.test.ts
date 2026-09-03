// @vitest-environment node

import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import type { CacheItem, CacheProvider } from '@node-saml/node-saml';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildSamlAuthnRedirectImpl,
  validateSamlResponseImpl,
} from './validate_assertion';

/**
 * Replay protection with the REAL node-saml: an SP-initiated SAMLResponse
 * must answer an AuthnRequest this deployment issued (InResponseTo found in
 * the cache provider), and only once — node-saml consumes the ID on
 * successful validation. IdP-initiated responses (no InResponseTo) stay
 * accepted under `ifPresent`.
 *
 * The signing fixture mirrors `integration-check.ts`'s checkSamlLogin: a
 * per-run RSA keypair, hand-canonicalized assertion XML signed with
 * node:crypto, and the "certificate" is a bare public-key PEM (node-saml's
 * keyInfoToPem accepts any RFC 7468 PEM) — no committed key material.
 */

const SP_ENTITY_ID = 'http://sp.itest/http_api/api/sso/saml/metadata';
const ACS_URL = 'http://sp.itest/http_api/api/sso/saml/acs';
const IDP_SSO_URL = 'https://idp.saml.itest/sso';

/** Map-backed CacheProvider with the InMemoryCacheProvider contract. */
function memoryCache(): CacheProvider & { keys: () => string[] } {
  const store = new Map<string, CacheItem>();
  return {
    keys: () => [...store.keys()],
    async saveAsync(key, value) {
      if (store.has(key)) return null;
      const item = { value, createdAt: Date.now() };
      store.set(key, item);
      return item;
    },
    async getAsync(key) {
      return store.get(key)?.value ?? null;
    },
    async removeAsync(key) {
      if (key !== null && store.delete(key)) return key;
      return null;
    },
  };
}

let publicKeyPem: string;
let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKeyPem = pair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  privateKey = pair.privateKey;
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A canonical, signed SAMLResponse (base64), optionally answering a request. */
function buildSignedResponse(opts: {
  id: string;
  email: string;
  inResponseTo?: string;
}): string {
  const now = Date.now();
  const notOnOrAfter = now + 300_000;
  const subjectConfirmationData = opts.inResponseTo
    ? `<saml:SubjectConfirmationData InResponseTo="${opts.inResponseTo}" NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${ACS_URL}"></saml:SubjectConfirmationData>`
    : `<saml:SubjectConfirmationData NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${ACS_URL}"></saml:SubjectConfirmationData>`;
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${opts.id}" IssueInstant="${iso(now)}" Version="2.0">` +
    `<saml:Issuer>https://idp.saml.itest/entity</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    subjectConfirmationData +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(now - 60_000)}" NotOnOrAfter="${iso(notOnOrAfter)}">` +
    `<saml:AudienceRestriction><saml:Audience>${SP_ENTITY_ID}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="${opts.id}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    `</saml:Assertion>`;
  const digest = createHash('sha256')
    .update(assertion, 'utf8')
    .digest('base64');
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></ds:SignatureMethod>` +
    `<ds:Reference URI="#${opts.id}"><ds:Transforms>` +
    `<ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></ds:Transform>` +
    `<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></ds:Transform>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>` +
    `<ds:DigestValue>${digest}</ds:DigestValue></ds:Reference></ds:SignedInfo>`;
  const signatureValue = createSign('RSA-SHA256')
    .update(signedInfo, 'utf8')
    .sign(privateKey, 'base64');
  const signature =
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${signedInfo}` +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue></ds:Signature>`;
  const signed = assertion.replace(
    '</saml:Issuer>',
    `</saml:Issuer>${signature}`,
  );
  const inResponseToAttr = opts.inResponseTo
    ? ` InResponseTo="${opts.inResponseTo}"`
    : '';
  return Buffer.from(
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp${opts.id}" IssueInstant="${iso(now)}" Version="2.0" Destination="${ACS_URL}"${inResponseToAttr}>` +
      `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"></samlp:StatusCode></samlp:Status>` +
      signed +
      `</samlp:Response>`,
  ).toString('base64');
}

function validateArgs(samlResponse: string) {
  return {
    samlResponse,
    idpSsoUrl: IDP_SSO_URL,
    idpCertificate: publicKeyPem,
    spEntityId: SP_ENTITY_ID,
    acsUrl: ACS_URL,
    wantAssertionsSigned: true,
  };
}

describe('SAML InResponseTo replay protection (real node-saml)', () => {
  it('saves the generated AuthnRequest ID when building the login redirect', async () => {
    const cache = memoryCache();

    const result = await buildSamlAuthnRedirectImpl(
      {
        idpSsoUrl: IDP_SSO_URL,
        idpCertificate: publicKeyPem,
        spEntityId: SP_ENTITY_ID,
        acsUrl: ACS_URL,
        relayState: 'org-1',
      },
      { cacheProvider: cache },
    );

    expect(result.url).toBeDefined();
    const requestParam = new URL(result.url ?? '').searchParams.get(
      'SAMLRequest',
    );
    expect(requestParam).not.toBeNull();
    const requestXml = inflateRawSync(
      Buffer.from(requestParam ?? '', 'base64'),
    ).toString('utf8');
    const requestId = /ID="([^"]+)"/.exec(requestXml)?.[1];
    expect(requestId).toBeDefined();
    // The ID is in the shared cache — the ACS on ANY instance can answer it.
    expect(await cache.getAsync(requestId ?? '')).not.toBeNull();
  });

  it('accepts a response answering an issued request, exactly once', async () => {
    const cache = memoryCache();
    await cache.saveAsync('_issued1', iso(Date.now()));
    const response = buildSignedResponse({
      id: '_assert1',
      email: 'saml.user@door.test',
      inResponseTo: '_issued1',
    });

    const first = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: cache,
    });
    expect(first.ok).toBe(true);
    expect(first.nameId).toBe('saml.user@door.test');
    // Consumed: the issued ID is gone from the cache…
    expect(await cache.getAsync('_issued1')).toBeNull();

    // …so REPLAYING the very same captured response is refused.
    const replay = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: cache,
    });
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatch(/InResponseTo is not valid/);
  });

  it('refuses a response answering a request this deployment never issued', async () => {
    const cache = memoryCache();
    const response = buildSignedResponse({
      id: '_assert2',
      email: 'saml.user@door.test',
      inResponseTo: '_forged',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: cache,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/InResponseTo is not valid/);
  });

  it('still accepts an IdP-initiated response (no InResponseTo) under ifPresent', async () => {
    const cache = memoryCache();
    const response = buildSignedResponse({
      id: '_assert3',
      email: 'idp.initiated@door.test',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: cache,
    });

    expect(result.ok).toBe(true);
    expect(result.nameId).toBe('idp.initiated@door.test');
  });
});
