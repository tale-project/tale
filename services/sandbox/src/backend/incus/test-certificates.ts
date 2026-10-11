// Throwaway certificates for the Incus backend's TLS tests, made with openssl
// into a private temp directory (never committed): the shapes that matter
// for pinning a server under Bun, and the client certificates that present
// themselves. Not used by production code.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const SERVER_EXTENSIONS = `basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1,DNS:localhost`;

const INCUS_DEFAULT_EXTENSIONS = `basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1,DNS:localhost`;

const CLIENT_EXTENSIONS = `basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = clientAuth`;

function make(
  dir: string,
  name: string,
  extensions: string,
): TestCertificate | null {
  const certFile = join(dir, `${name}.crt`);
  const keyFile = join(dir, `${name}.key`);
  const configFile = join(dir, `${name}.cnf`);
  writeFileSync(
    configFile,
    `[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = ${name}
[ext]
${extensions}
`,
  );
  const made = spawnSync(
    // Ephemeral localhost fixture keys, confined to mkdtemp's private directory and removed after the suite.
    // nosemgrep: tools.opengrep.rules.trailofbits.generic.openssl-insecure-flags.openssl-insecure-flags
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      keyFile,
      '-out',
      certFile,
      '-days',
      '2',
      '-config',
      configFile,
    ],
    { stdio: 'ignore' },
  );
  if (made.status !== 0) return null;
  return {
    cert: readFileSync(certFile, 'utf8'),
    key: readFileSync(keyFile, 'utf8'),
    certFile,
    keyFile,
  };
}

/** The certificates, or null where openssl is missing (the TLS tests then
 * skip, as the Kubernetes client's do). */
export function makeTestCertificates(): TestCertificates | null {
  const dir = mkdtempSync(join(tmpdir(), 'incus-tls-test-'));
  const server = make(dir, 'server', SERVER_EXTENSIONS);
  const otherServer = make(dir, 'other-server', SERVER_EXTENSIONS);
  const incusDefault = make(dir, 'incus-default', INCUS_DEFAULT_EXTENSIONS);
  const client = make(dir, 'client', CLIENT_EXTENSIONS);
  const otherClient = make(dir, 'other-client', CLIENT_EXTENSIONS);
  if (!server || !otherServer || !incusDefault || !client || !otherClient) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  return {
    dir,
    server,
    otherServer,
    incusDefault,
    client,
    otherClient,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
