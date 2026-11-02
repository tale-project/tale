// The self-signed mode's certificates: a local CA kept in the data volume,
// and a leaf for every host the edge serves, signed by it. What Caddy's
// internal issuer did, written with WebCrypto so that njs (in the image) and
// Bun (in the tests) run the same code.
//
// The CA lives ten years and is made once; clients trust it by installing
// /data/pki/root.crt. The leaf lives a year and is reissued when fewer than
// 30 days remain or when the hosts change.

const DAY = 24 * 60 * 60 * 1000;
export const CA_DAYS = 3650;
export const LEAF_DAYS = 365;
export const RENEW_DAYS = 30;

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

// --- DER, the few shapes a certificate needs ---------------------------------

function length(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) {
    bytes.unshift(rest % 256);
  }
  return [0x80 | bytes.length].concat(bytes);
}
const tlv = (tag, content) => [tag].concat(length(content.length), content);
const flat = (items) => [].concat(...items);
const seq = (...items) => tlv(0x30, flat(items));
const set = (...items) => tlv(0x31, flat(items));
const explicit = (n, ...items) => tlv(0xa0 + n, flat(items));
const octets = (bytes) => tlv(0x04, bytes);
const bitString = (bytes) => tlv(0x03, [0].concat(bytes));
const TRUE = [0x01, 0x01, 0xff];

/** An unsigned big-endian integer as a DER INTEGER. */
function integer(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start++;
  const value = bytes.slice(start);
  return tlv(0x02, value[0] & 0x80 ? [0].concat(value) : value);
}

function oid(dotted) {
  const arcs = dotted.split('.').map(Number);
  const out = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunk = [arc % 128];
    for (
      let rest = Math.floor(arc / 128);
      rest > 0;
      rest = Math.floor(rest / 128)
    ) {
      chunk.unshift(0x80 | (rest % 128));
    }
    out.push(...chunk);
  }
  return tlv(0x06, out);
}

function ascii(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7e) throw new Error(`not ASCII: ${text}`);
    out.push(code);
  }
  return out;
}
const utf8String = (text) => tlv(0x0c, ascii(text));

/** UTCTime until 2049, GeneralizedTime after (RFC 5280, 4.1.2.5). */
function time(ms) {
  const iso = new Date(ms).toISOString();
  const digits = iso.slice(0, 19).replace(/[-T:]/g, '');
  const year = Number(iso.slice(0, 4));
  return year < 2050
    ? tlv(0x17, ascii(`${digits.slice(2)}Z`))
    : tlv(0x18, ascii(`${digits}Z`));
}

const OID = {
  organization: '2.5.4.10',
  commonName: '2.5.4.3',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  subjectKeyIdentifier: '2.5.29.14',
  keyUsage: '2.5.29.15',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  authorityKeyIdentifier: '2.5.29.35',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

const name = (entries) =>
  seq(
    ...entries.map(([type, value]) => set(seq(oid(type), utf8String(value)))),
  );
const extension = (type, critical, value) =>
  critical
    ? seq(oid(type), TRUE, octets(value))
    : seq(oid(type), octets(value));

/** An IPv4 or IPv6 literal as its address bytes, or null for a hostname. */
export function ipBytes(host) {
  if (/^[0-9]+(\.[0-9]+){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    return parts.every((part) => part <= 255) ? parts : null;
  }
  if (!host.includes(':')) return null;
  let text = host;
  let tail = [];
  const v4 = /:([0-9]+(\.[0-9]+){3})$/.exec(text);
  if (v4) {
    tail = ipBytes(v4[1]);
    if (!tail) return null;
    text = `${text.slice(0, v4.index)}:0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (part) => (part === '' ? [] : part.split(':'));
  const head = groups(halves[0]);
  const rest = halves.length === 2 ? groups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const all = head.concat(
    new Array(halves.length === 2 ? missing : 0).fill('0'),
    rest,
  );
  const out = [];
  for (const group of all) {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    out.push(value >> 8, value & 0xff);
  }
  if (v4) out.splice(12, 4, ...tail);
  return out;
}

// --- PEM ---------------------------------------------------------------------

const bytesOf = (buffer) => Array.from(new Uint8Array(buffer));

function pem(label, bytes) {
  const base64 = Buffer.from(Uint8Array.from(bytes)).toString('base64');
  const lines = base64.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

export function unpem(text) {
  const body = text.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Array.from(Buffer.from(body, 'base64'));
}

/** The subject key identifier this module wrote into a certificate. */
export function keyIdOf(der) {
  const marker = oid(OID.subjectKeyIdentifier).concat([0x04, 0x16, 0x04, 0x14]);
  for (let i = 0; i + marker.length + 20 <= der.length; i++) {
    if (marker.every((byte, j) => der[i + j] === byte)) {
      return der.slice(i + marker.length, i + marker.length + 20);
    }
  }
  return null;
}

// --- Issuing -----------------------------------------------------------------

async function keyId(subtle, spki) {
  return bytesOf(await subtle.digest('SHA-256', Uint8Array.from(spki))).slice(
    0,
    20,
  );
}

/** The DER of an ECDSA signature from WebCrypto's raw r‖s. */
function signatureDer(raw) {
  const half = raw.length / 2;
  return seq(integer(raw.slice(0, half)), integer(raw.slice(half)));
}

async function certificate(subtle, random, fields) {
  const serial = random(16);
  serial[0] &= 0x7f;
  const algorithm = seq(oid(OID.ecdsaWithSha256));
  const tbs = seq(
    explicit(0, integer([2])),
    integer(serial),
    algorithm,
    fields.issuer,
    seq(time(fields.notBefore), time(fields.notAfter)),
    fields.subject,
    fields.spki,
    explicit(3, seq(...fields.extensions)),
  );
  const raw = bytesOf(
    await subtle.sign(SIGN, fields.signer, Uint8Array.from(tbs)),
  );
  return seq(tbs, algorithm, bitString(signatureDer(raw)));
}

const CA_NAME = [
  [OID.organization, 'Tale'],
  [OID.commonName, 'Tale Local CA'],
];

async function issueRoot(subtle, random, now) {
  const keys = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const spki = bytesOf(await subtle.exportKey('spki', keys.publicKey));
  const id = await keyId(subtle, spki);
  const der = await certificate(subtle, random, {
    issuer: name(CA_NAME),
    subject: name(CA_NAME),
    notBefore: now - 60 * 60 * 1000,
    notAfter: now + CA_DAYS * DAY,
    spki,
    signer: keys.privateKey,
    extensions: [
      extension(OID.basicConstraints, true, seq(TRUE, integer([0]))),
      extension(OID.keyUsage, true, [0x03, 0x02, 0x01, 0x06]),
      extension(OID.subjectKeyIdentifier, false, octets(id)),
    ],
  });
  const key = bytesOf(await subtle.exportKey('pkcs8', keys.privateKey));
  return { key: pem('PRIVATE KEY', key), cert: pem('CERTIFICATE', der) };
}

async function issueLeaf(subtle, random, now, root, hosts) {
  const signer = await subtle.importKey(
    'pkcs8',
    Uint8Array.from(unpem(root.key)),
    ECDSA,
    false,
    ['sign'],
  );
  const issuerId = keyIdOf(unpem(root.cert));
  if (!issuerId)
    throw new Error('the CA certificate carries no key identifier');
  const keys = await subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const spki = bytesOf(await subtle.exportKey('spki', keys.publicKey));
  const names = hosts.map((host) => {
    const ip = ipBytes(host);
    return ip ? tlv(0x87, ip) : tlv(0x82, ascii(host));
  });
  const notAfter = now + LEAF_DAYS * DAY;
  const der = await certificate(subtle, random, {
    issuer: name(CA_NAME),
    subject: name([[OID.commonName, hosts[0]]]),
    notBefore: now - 60 * 60 * 1000,
    notAfter,
    spki,
    signer,
    extensions: [
      extension(OID.basicConstraints, true, seq()),
      extension(OID.keyUsage, true, [0x03, 0x02, 0x07, 0x80]),
      extension(OID.extKeyUsage, false, seq(oid(OID.serverAuth))),
      extension(
        OID.subjectKeyIdentifier,
        false,
        octets(await keyId(subtle, spki)),
      ),
      extension(OID.authorityKeyIdentifier, false, seq(tlv(0x80, issuerId))),
      extension(OID.subjectAltName, false, seq(...names)),
    ],
  });
  const key = bytesOf(await subtle.exportKey('pkcs8', keys.privateKey));
  return {
    key: pem('PRIVATE KEY', key),
    cert: pem('CERTIFICATE', der),
    notAfter,
  };
}

/**
 * Makes sure `dir` holds a CA and a current leaf for `hosts`. `io` reads a
 * file (null when absent) and writes one with a mode; the CA is made only
 * when it is absent, so a client that trusted it keeps trusting it.
 * Answers what it did, and the leaf's certificate and key.
 */
export async function ensureCertificates({ dir, hosts, now, io, crypto }) {
  const subtle = crypto.subtle;
  const random = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)));
  const paths = {
    rootKey: `${dir}/root.key`,
    rootCert: `${dir}/root.crt`,
    leafKey: `${dir}/leaf.key`,
    leafCert: `${dir}/leaf.crt`,
    leafState: `${dir}/leaf.json`,
  };
  const actions = [];

  let root = { key: io.read(paths.rootKey), cert: io.read(paths.rootCert) };
  const newRoot = !root.key || !root.cert;
  if (newRoot) {
    root = await issueRoot(subtle, random, now);
    io.write(paths.rootKey, root.key, 0o600);
    io.write(paths.rootCert, root.cert, 0o644);
    actions.push('created the local CA');
  }

  let state = null;
  try {
    state = JSON.parse(io.read(paths.leafState) || 'null');
  } catch (error) {
    actions.push(`found the leaf's state unreadable (${error.message})`);
  }
  let leaf = { key: io.read(paths.leafKey), cert: io.read(paths.leafCert) };
  const current =
    !newRoot &&
    state !== null &&
    leaf.key !== null &&
    leaf.cert !== null &&
    JSON.stringify(state.hosts) === JSON.stringify(hosts) &&
    state.notAfter - now > RENEW_DAYS * DAY;
  if (!current) {
    leaf = await issueLeaf(subtle, random, now, root, hosts);
    io.write(paths.leafKey, leaf.key, 0o600);
    io.write(paths.leafCert, leaf.cert, 0o644);
    state = { hosts, notAfter: leaf.notAfter };
    io.write(paths.leafState, `${JSON.stringify(state)}\n`, 0o644);
    actions.push(`issued a leaf for ${hosts.join(', ')}`);
  }

  return { actions, cert: leaf.cert, key: leaf.key, notAfter: state.notAfter };
}
