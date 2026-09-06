// @vitest-environment node

import {
  constants as cryptoConstants,
  createCipheriv,
  createHash,
  createSign,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import type { CacheItem, CacheProvider } from '@node-saml/node-saml';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildSamlAuthnRedirectImpl,
  SAML_ASSERTION_NOT_ENCRYPTED_KEY,
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
 * keyInfoToPem accepts any RFC 7468 PEM) — no committed key material. The
 * encryption fixture wraps that signed assertion the way an IdP does
 * (XML-Enc: AES-256-CBC content key, RSA-OAEP key transport — the shape
 * xml-encryption's `decrypt` reads), under a per-run SP keypair.
 */

const IDP_ENTITY_ID = 'https://idp.saml.itest/entity';
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
let spPublicKey: KeyObject;
let spPrivateKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKeyPem = pair.publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();
  privateKey = pair.privateKey;
  const spPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  spPublicKey = spPair.publicKey;
  spPrivateKeyPem = spPair.privateKey
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
});

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

interface ResponseOpts {
  id: string;
  email: string;
  inResponseTo?: string;
  /** The assertion's Issuer — the connection's IdP entity ID by default. */
  issuer?: string;
  /** Leave the Response element's InResponseTo off (a forwarder stripping
   * it) while the signed Subject still carries it. */
  omitResponseInResponseTo?: boolean;
}

/** A canonical, signed `saml:Assertion` (the IdP's signing step). */
function signedAssertion(opts: ResponseOpts): string {
  const now = Date.now();
  const notOnOrAfter = now + 300_000;
  const subjectConfirmationData = opts.inResponseTo
    ? `<saml:SubjectConfirmationData InResponseTo="${opts.inResponseTo}" NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${ACS_URL}"></saml:SubjectConfirmationData>`
    : `<saml:SubjectConfirmationData NotOnOrAfter="${iso(notOnOrAfter)}" Recipient="${ACS_URL}"></saml:SubjectConfirmationData>`;
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${opts.id}" IssueInstant="${iso(now)}" Version="2.0">` +
    `<saml:Issuer>${opts.issuer ?? IDP_ENTITY_ID}</saml:Issuer>` +
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
  return assertion.replace('</saml:Issuer>', `</saml:Issuer>${signature}`);
}

/** The `samlp:Response` envelope (base64, POST binding) around `body`. */
function wrapResponse(body: string, opts: ResponseOpts): string {
  const inResponseToAttr =
    opts.inResponseTo && !opts.omitResponseInResponseTo
      ? ` InResponseTo="${opts.inResponseTo}"`
      : '';
  return Buffer.from(
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_resp${opts.id}" IssueInstant="${iso(Date.now())}" Version="2.0" Destination="${ACS_URL}"${inResponseToAttr}>` +
      `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"></samlp:StatusCode></samlp:Status>` +
      body +
      `</samlp:Response>`,
  ).toString('base64');
}

/** A canonical, signed SAMLResponse (base64), optionally answering a request. */
function buildSignedResponse(opts: ResponseOpts): string {
  return wrapResponse(signedAssertion(opts), opts);
}

/**
 * The IdP's encryption step over a signed assertion: a fresh AES-256-CBC
 * content key (IV prefixed, PKCS#7 padded — what xml-encryption strips),
 * transported under RSA-OAEP (SHA-1 MGF1, xml-encryption's default) to the
 * SP's public key, laid out as `EncryptedData/KeyInfo/EncryptedKey`.
 */
function encryptedAssertion(
  assertionXml: string,
  recipient: KeyObject,
): string {
  const contentKey = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', contentKey, iv);
  const ciphertext = Buffer.concat([
    iv,
    cipher.update(assertionXml, 'utf8'),
    cipher.final(),
  ]);
  const wrappedKey = publicEncrypt(
    {
      key: recipient,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha1',
    },
    contentKey,
  );
  return (
    `<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">` +
    `<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" Type="http://www.w3.org/2001/04/xmlenc#Element">` +
    `<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"></xenc:EncryptionMethod>` +
    `<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
    `<xenc:EncryptedKey>` +
    `<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"></xenc:EncryptionMethod>` +
    `<xenc:CipherData><xenc:CipherValue>${wrappedKey.toString('base64')}</xenc:CipherValue></xenc:CipherData>` +
    `</xenc:EncryptedKey>` +
    `</ds:KeyInfo>` +
    `<xenc:CipherData><xenc:CipherValue>${ciphertext.toString('base64')}</xenc:CipherValue></xenc:CipherData>` +
    `</xenc:EncryptedData>` +
    `</saml:EncryptedAssertion>`
  );
}

function validateArgs(samlResponse: string) {
  return {
    samlResponse,
    idpEntityId: IDP_ENTITY_ID,
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
        idpEntityId: IDP_ENTITY_ID,
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

/**
 * `wantAssertionsEncrypted` is a REQUIREMENT, not a capability flag: with it
 * set, a validly signed plaintext assertion is refused (bounced under its own
 * login-page key), while the same assertion encrypted to the SP keypair is
 * accepted — and everything that is not the encryption question stays
 * node-saml's call.
 */
describe('SAML wantAssertionsEncrypted (real node-saml)', () => {
  it('refuses a signed plaintext assertion when the connection requires encryption', async () => {
    const response = buildSignedResponse({
      id: '_plain1',
      email: 'saml.user@door.test',
    });

    const result = await validateSamlResponseImpl(
      {
        ...validateArgs(response),
        spPrivateKey: spPrivateKeyPem,
        wantAssertionsEncrypted: true,
      },
      { cacheProvider: memoryCache() },
    );

    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe(SAML_ASSERTION_NOT_ENCRYPTED_KEY);
    expect(result.error).toMatch(/requires encrypted assertions/);
    expect(result.nameId).toBeUndefined();
  });

  it('keeps accepting the plaintext assertion while encryption is not required', async () => {
    const response = buildSignedResponse({
      id: '_plain2',
      email: 'saml.user@door.test',
    });

    const relaxed = await validateSamlResponseImpl(
      { ...validateArgs(response), spPrivateKey: spPrivateKeyPem },
      { cacheProvider: memoryCache() },
    );
    const explicit = await validateSamlResponseImpl(
      {
        ...validateArgs(response),
        spPrivateKey: spPrivateKeyPem,
        wantAssertionsEncrypted: false,
      },
      { cacheProvider: memoryCache() },
    );

    expect(relaxed.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    expect(explicit.nameId).toBe('saml.user@door.test');
  });

  it('accepts the same assertion encrypted to the SP keypair when required', async () => {
    const opts = { id: '_enc1', email: 'encrypted.user@door.test' };
    const response = wrapResponse(
      encryptedAssertion(signedAssertion(opts), spPublicKey),
      opts,
    );

    const result = await validateSamlResponseImpl(
      {
        ...validateArgs(response),
        spPrivateKey: spPrivateKeyPem,
        wantAssertionsEncrypted: true,
      },
      { cacheProvider: memoryCache() },
    );

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.nameId).toBe('encrypted.user@door.test');
  });

  it('leaves every other verdict on an encrypted assertion to node-saml', async () => {
    // Encrypted to a key the SP does NOT hold: the requirement is met, so the
    // refusal is node-saml's decryption failure — never the encryption key.
    const opts = { id: '_enc2', email: 'encrypted.user@door.test' };
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const response = wrapResponse(
      encryptedAssertion(signedAssertion(opts), stranger.publicKey),
      opts,
    );

    const result = await validateSamlResponseImpl(
      {
        ...validateArgs(response),
        spPrivateKey: spPrivateKeyPem,
        wantAssertionsEncrypted: true,
      },
      { cacheProvider: memoryCache() },
    );

    expect(result.ok).toBe(false);
    expect(result.errorKey).toBeUndefined();
    expect(result.error).not.toMatch(/requires encrypted assertions/);
  });
});

/**
 * The connection's IdP entity ID is required, stored and (now) enforced: an
 * assertion signed with the right certificate but issued under another
 * entity ID is refused — the defence node-saml offers for shared or rotated
 * signing certificates was collected by the admin door and never applied.
 */
describe('SAML issuer enforcement (real node-saml)', () => {
  it('refuses a correctly signed assertion from a different issuer', async () => {
    const response = buildSignedResponse({
      id: '_issuer1',
      email: 'saml.user@door.test',
      issuer: 'https://other-idp.example/entity',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: memoryCache(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown SAML issuer/);
    expect(result.nameId).toBeUndefined();
  });

  it('accepts the same assertion under the configured entity ID', async () => {
    const response = buildSignedResponse({
      id: '_issuer2',
      email: 'saml.user@door.test',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: memoryCache(),
    });

    expect(result.ok).toBe(true);
    expect(result.nameId).toBe('saml.user@door.test');
  });
});

/**
 * The ACS demands the browser binding exactly when the response answers an
 * AuthnRequest, so the validator reports which — from the Response element,
 * or from the signed Subject when the Response-level attribute was stripped
 * (node-saml checks the Subject's only when the Response's is present).
 */
describe('SAML InResponseTo reporting (real node-saml)', () => {
  it('reports the answered request id of an SP-initiated response', async () => {
    const cache = memoryCache();
    await cache.saveAsync('_issued9', iso(Date.now()));
    const response = buildSignedResponse({
      id: '_report1',
      email: 'saml.user@door.test',
      inResponseTo: '_issued9',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: cache,
    });

    expect(result.ok).toBe(true);
    expect(result.inResponseTo).toBe('_issued9');
  });

  it('still reports it when only the signed Subject carries it', async () => {
    const response = buildSignedResponse({
      id: '_report2',
      email: 'saml.user@door.test',
      inResponseTo: '_issued10',
      omitResponseInResponseTo: true,
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: memoryCache(),
    });

    expect(result.ok).toBe(true);
    expect(result.inResponseTo).toBe('_issued10');
  });

  it('reports nothing for an IdP-initiated response', async () => {
    const response = buildSignedResponse({
      id: '_report3',
      email: 'idp.initiated@door.test',
    });

    const result = await validateSamlResponseImpl(validateArgs(response), {
      cacheProvider: memoryCache(),
    });

    expect(result.ok).toBe(true);
    expect(result.inResponseTo).toBeUndefined();
  });
});
