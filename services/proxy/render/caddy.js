// What the Caddy edge of Tale 0.5 left in its data volume (`caddy-data`),
// which an upgraded install mounts read-only at /caddy-data. The edge takes
// over what it can serve on its first start, so an upgrade keeps its
// certificates; the volume itself never changes, so the previous release
// still finds it as it was.
//
//   caddy/pki/authorities/local/root.{crt,key}
//       the local CA of TLS_MODE=selfsigned, which clients may trust
//   caddy/certificates/acme-v02.api.letsencrypt.org-directory/<host>/<host>.{crt,key}
//       the Let's Encrypt certificate of each host
//
// Caddy's own intermediate (7 days) and self-signed leaves (12 hours) are
// not worth keeping, and a certificate from another issuer (ZeroSSL, Caddy's
// fallback) cannot be renewed by the edge's resolver: Traefik asks for those
// hosts again, one order each.
import {
  dnsNames,
  keyMatches,
  pemBlocks,
  pkcs8Of,
  readCertificate,
} from './pki.js';

const LOCAL_CA = 'caddy/pki/authorities/local';
const LETS_ENCRYPT =
  'caddy/certificates/acme-v02.api.letsencrypt.org-directory';
const SOURCE = 'the Caddy proxy';

/** The Caddy edge's local CA, as `ensureCertificates` adopts it, or null. */
export function caddyRoot({ dir, io }) {
  const key = io.read(`${dir}/${LOCAL_CA}/root.key`);
  const cert = io.read(`${dir}/${LOCAL_CA}/root.crt`);
  return key && cert ? { key, cert, source: SOURCE } : null;
}

/** Why a certificate cannot serve `host` now, or null when it can. */
async function unusable(subtle, pair, host, now) {
  const blocks = pemBlocks(pair.cert);
  if (blocks.length === 0 || blocks[0].label !== 'CERTIFICATE') {
    return 'it has no certificate';
  }
  const leaf = readCertificate(blocks[0].der);
  if (!dnsNames(leaf).includes(host)) return 'it does not name the host';
  if (leaf.notAfter <= now) {
    return `it ended on ${new Date(leaf.notAfter).toISOString()}`;
  }
  const key = pkcs8Of(pair.key);
  if (!leaf.curve || !key) return 'its key is no EC key';
  if (!(await keyMatches(subtle, key, leaf.spki, leaf.curve))) {
    return 'its private key does not belong to it';
  }
  return null;
}

/**
 * The Let's Encrypt certificates the Caddy edge kept for `hosts`, as the
 * ACME storage of Traefik's resolver `resolver` (acme.json): each one that
 * names its host, has not ended and comes with its key. Traefik renews them
 * as its own and registers an account when it first has to order. Answers
 * the storage (null when there is nothing to take over) and what it did.
 */
export async function caddyAcme({ dir, hosts, resolver, now, io, crypto }) {
  const certificates = [];
  const actions = [];
  for (const host of hosts) {
    const base = `${dir}/${LETS_ENCRYPT}/${host}/${host}`;
    const pair = { cert: io.read(`${base}.crt`), key: io.read(`${base}.key`) };
    if (!pair.cert || !pair.key) continue;
    let reason;
    try {
      reason = await unusable(crypto.subtle, pair, host, now);
    } catch (error) {
      reason = `it cannot be read (${error.message})`;
    }
    if (reason) {
      actions.push(`left the certificate of ${SOURCE} for ${host}: ${reason}`);
      continue;
    }
    certificates.push({
      domain: { main: host },
      certificate: Buffer.from(pair.cert).toString('base64'),
      key: Buffer.from(pair.key).toString('base64'),
      Store: 'default',
    });
    actions.push(`took over the certificate of ${SOURCE} for ${host}`);
  }
  const storage =
    certificates.length > 0
      ? { [resolver]: { Account: null, Certificates: certificates } }
      : null;
  return { storage, actions };
}
