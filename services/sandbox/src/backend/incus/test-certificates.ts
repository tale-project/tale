// Throwaway certificates for the Incus backend's TLS tests, made in process
// (WebCrypto and @peculiar/x509, no external binary) into a private temp
// directory (never committed): the shapes that matter for pinning a server
// under Bun, and the client certificates that present themselves. Made without
// an `openssl` on the PATH on purpose: a test of the pinning that quietly
// skipped itself where the binary is missing would be a green that proves
// nothing. Not used by production code.

import { createPrivateKey } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BasicConstraintsExtension,
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
  type Extension,
} from '@peculiar/x509';

export interface TestCertificate {
  cert: string;
  key: string;
  certFile: string;
  keyFile: string;
}

export interface TestCertificates {
  dir: string;
  /** What hostkit gives the node: self-signed, CA:TRUE pathlen:0,
   * keyCertSign, serverAuth, 127.0.0.1 in the SAN. Pinnable. */
  server: TestCertificate;
  /** A second pinnable server certificate: the wrong anchor. */
  otherServer: TestCertificate;
  /** What Incus makes by default: self-signed, CA:FALSE. Bun cannot pin it. */
  incusDefault: TestCertificate;
  /** A client certificate. CA:TRUE only so that a Bun test server can verify
   * it against itself; Incus compares fingerprints instead. */
  client: TestCertificate;
  otherClient: TestCertificate;
  dispose(): void;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SAN = new SubjectAlternativeNameExtension([
  { type: 'ip', value: '127.0.0.1' },
  { type: 'dns', value: 'localhost' },
]);

function serverExtensions(isCa: boolean): Extension[] {
  return [
    new BasicConstraintsExtension(isCa, isCa ? 0 : undefined, true),
    new KeyUsagesExtension(
      KeyUsageFlags.digitalSignature |
        KeyUsageFlags.keyEncipherment |
        (isCa ? KeyUsageFlags.keyCertSign : 0),
      true,
    ),
    new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth], false),
    SAN,
  ];
}

const CLIENT_EXTENSIONS: Extension[] = [
  new BasicConstraintsExtension(true, 0, true),
  new KeyUsagesExtension(
    KeyUsageFlags.digitalSignature | KeyUsageFlags.keyCertSign,
    true,
  ),
  new ExtendedKeyUsageExtension([ExtendedKeyUsage.clientAuth], false),
];

async function make(
  dir: string,
  name: string,
  extensions: Extension[],
  serialNumber: string,
): Promise<TestCertificate> {
  const keys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber,
    name: `CN=${name}`,
    // Valid from an hour ago for two days: inside the two-week expiry warning,
    // which the TLS material tests expect to hear.
    notBefore: new Date(Date.now() - HOUR_MS),
    notAfter: new Date(Date.now() + 2 * DAY_MS),
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    keys,
    extensions,
  });
  const cert = certificate.toString('pem');
  const key = createPrivateKey({
    key: Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)),
    format: 'der',
    type: 'pkcs8',
  })
    .export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const certFile = join(dir, `${name}.crt`);
  const keyFile = join(dir, `${name}.key`);
  writeFileSync(certFile, cert);
  writeFileSync(keyFile, key, { mode: 0o600 });
  return { cert, key, certFile, keyFile };
}

export async function makeTestCertificates(): Promise<TestCertificates> {
  const dir = mkdtempSync(join(tmpdir(), 'incus-tls-test-'));
  try {
    return {
      dir,
      server: await make(dir, 'server', serverExtensions(true), '01'),
      otherServer: await make(
        dir,
        'other-server',
        serverExtensions(true),
        '02',
      ),
      incusDefault: await make(
        dir,
        'incus-default',
        serverExtensions(false),
        '03',
      ),
      client: await make(dir, 'client', CLIENT_EXTENSIONS, '04'),
      otherClient: await make(dir, 'other-client', CLIENT_EXTENSIONS, '05'),
      dispose: () => rmSync(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
