// Certificates shaped as the Caddy edge kept them, for the tests of what the
// edge takes over (caddy.js, pki.js): made by OpenSSL with SEC 1 keys, the
// form Go, and so Caddy, writes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface KeyPair {
  key: string;
  cert: string;
}

interface Options {
  /** OpenSSL's name of the key's curve. */
  curve?: string;
  days?: number;
  /** The certificate's extensions, as `openssl req -addext` takes them. */
  extensions?: string[];
}

/** A key and a certificate for `subject`, signed by `issuer` or by itself. */
function make(subject: string, options: Options, issuer?: KeyPair): KeyPair {
  const dir = mkdtempSync(join(tmpdir(), 'tale-caddy-fixture-'));
  const openssl = (...args: string[]) => {
    const result = spawnSync('openssl', args, { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`openssl ${args[0]} failed: ${result.stderr}`);
    }
  };
  try {
    writeFileSync(
      join(dir, 'req.cnf'),
      '[req]\ndistinguished_name = dn\n[dn]\n',
    );
    openssl(
      'ecparam',
      '-name',
      options.curve ?? 'prime256v1',
      '-genkey',
      '-noout',
      '-out',
      'key.pem',
    );
    const signer: string[] = [];
    if (issuer) {
      writeFileSync(join(dir, 'issuer.key'), issuer.key);
      writeFileSync(join(dir, 'issuer.crt'), issuer.cert);
      signer.push('-CA', 'issuer.crt', '-CAkey', 'issuer.key');
    }
    openssl(
      'req',
      '-config',
      'req.cnf',
      '-x509',
      '-new',
      '-key',
      'key.pem',
      ...signer,
      '-out',
      'cert.pem',
      '-days',
      String(options.days ?? 90),
      '-subj',
      `/CN=${subject}`,
      ...(options.extensions ?? []).flatMap((value) => ['-addext', value]),
    );
    return {
      key: readFileSync(join(dir, 'key.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A local CA as Caddy makes it: P-256, ten years, an intermediate below. */
export const caddyCa = (options: Options = {}): KeyPair =>
  make('Caddy Local Authority - 2026 ECC Root', {
    days: 3650,
    extensions: [
      'basicConstraints=critical,CA:TRUE,pathlen:1',
      'keyUsage=critical,keyCertSign,cRLSign',
    ],
    ...options,
  });

/**
 * A server certificate for `hosts` signed by `issuer`, as Caddy stores the
 * one it got from an ACME issuer: the leaf, then the chain.
 */
export function serverCert(
  issuer: KeyPair,
  hosts: string[],
  options: Options = {},
): KeyPair {
  const leaf = make(
    hosts[0] ?? 'localhost',
    {
      extensions: [
        `subjectAltName=${hosts.map((host) => `DNS:${host}`).join(',')}`,
        'basicConstraints=critical,CA:FALSE',
        'extendedKeyUsage=serverAuth',
      ],
      ...options,
    },
    issuer,
  );
  return { key: leaf.key, cert: `${leaf.cert}${issuer.cert}` };
}
