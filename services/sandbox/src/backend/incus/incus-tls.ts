// Reads the three PEM files the Incus connection needs and refuses, at boot
// and in words, what could only fail later as an opaque TLS error: a server
// certificate Bun cannot pin, a key that is not the client certificate's, a
// certificate that has expired.

import { createPrivateKey, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { IncusConfig } from '../../types.ts';
import type { IncusTlsMaterial } from './incus-client.ts';

/** Warn when a certificate has less than this left. */
const EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

async function readPem(variable: string, path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `${variable}: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function parseCertificate(
  variable: string,
  path: string,
  pem: string,
): X509Certificate {
  try {
    return new X509Certificate(pem);
  } catch (error) {
    throw new Error(
      `${variable}: ${path} holds no PEM certificate: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function checkValidity(
  variable: string,
  cert: X509Certificate,
  nowMs: number,
): void {
  const notAfter = new Date(cert.validTo).getTime();
  if (Number.isFinite(notAfter) && notAfter <= nowMs) {
    throw new Error(`${variable}: the certificate expired on ${cert.validTo}`);
  }
  if (Number.isFinite(notAfter) && notAfter - nowMs < EXPIRY_WARNING_MS) {
    console.warn(
      `[sandbox.incus] ${variable}: the certificate expires on ${cert.validTo}; renew it before then`,
    );
  }
  const notBefore = new Date(cert.validFrom).getTime();
  if (Number.isFinite(notBefore) && notBefore > nowMs) {
    throw new Error(
      `${variable}: the certificate is not valid before ${cert.validFrom} (check the clock)`,
    );
  }
}

/**
 * The material `IncusClient` presents and pins. Throws a message that names
 * the variable and says what to change.
 */
export async function readIncusTlsMaterial(
  files: Pick<
    IncusConfig,
    'clientCertFile' | 'clientKeyFile' | 'serverCertFile'
  >,
  nowMs: number = Date.now(),
): Promise<IncusTlsMaterial> {
  const [cert, key, ca] = await Promise.all([
    readPem('SANDBOX_INCUS_CLIENT_CERT_FILE', files.clientCertFile),
    readPem('SANDBOX_INCUS_CLIENT_KEY_FILE', files.clientKeyFile),
    readPem('SANDBOX_INCUS_SERVER_CERT_FILE', files.serverCertFile),
  ]);

  const server = parseCertificate(
    'SANDBOX_INCUS_SERVER_CERT_FILE',
    files.serverCertFile,
    ca,
  );
  if (!server.ca) {
    throw new Error(
      `SANDBOX_INCUS_SERVER_CERT_FILE: ${files.serverCertFile} is not a certificate Bun can pin. ` +
        'The connection is verified against this file as its trust anchor, and a ' +
        "certificate with basicConstraints CA:FALSE (Incus's default server " +
        'certificate) is refused by the TLS stack as UNABLE_TO_VERIFY_LEAF_SIGNATURE. ' +
        'Give the Incus server a certificate that is its own anchor (self-signed, ' +
        'CA:TRUE with pathlen:0, keyUsage keyCertSign, extendedKeyUsage serverAuth, ' +
        'the API address in subjectAltName) — hostkit does — and point this ' +
        'variable at it. Certificate verification is never turned off.',
    );
  }
  checkValidity('SANDBOX_INCUS_SERVER_CERT_FILE', server, nowMs);

  const client = parseCertificate(
    'SANDBOX_INCUS_CLIENT_CERT_FILE',
    files.clientCertFile,
    cert,
  );
  checkValidity('SANDBOX_INCUS_CLIENT_CERT_FILE', client, nowMs);
  try {
    if (!client.checkPrivateKey(createPrivateKey(key))) {
      throw new Error('the key does not belong to the certificate');
    }
  } catch (error) {
    throw new Error(
      `SANDBOX_INCUS_CLIENT_KEY_FILE: ${files.clientKeyFile} is not the (unencrypted PEM) private key of ${files.clientCertFile}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }

  return { ca, cert, key };
}
