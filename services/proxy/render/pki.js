// The self-signed mode's certificates: a local CA kept in the data volume,
// and a leaf for every host the edge serves, signed by it. Written with
// WebCrypto so that njs (in the image) and Bun (in the tests) run the same
// code.
//
// The CA lives ten years and is made once; clients trust it by installing
// /data/pki/root.crt. An install upgraded from the Caddy edge adopts Caddy's
// local CA instead (caddy.js), so the clients that trust it keep trusting.
// The leaf lives a year and is reissued when fewer than 30 days remain or
// when the hosts change.

const DAY = 24 * 60 * 60 * 1000;
const CA_DAYS = 3650;
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
  ecPublicKey: '1.2.840.10045.2.1',
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

function unpem(text) {
  const body = text.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  return Array.from(Buffer.from(body, 'base64'));
}

/** The blocks of a PEM text in order, each with its label and its DER. */
export function pemBlocks(text) {
  const blocks = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----([^-]*)-----END \1-----/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const body = match[2].replace(/\s+/g, '');
    blocks.push({
      label: match[1],
      der: Array.from(Buffer.from(body, 'base64')),
    });
  }
  return blocks;
}

// --- Reading DER: the certificates and keys this edge takes over -------------

/** The TLV at `offset`: its tag, where it starts, and its content's range. */
function node(der, offset, limit = der.length) {
  const tag = der[offset];
  let size = der[offset + 1];
  let start = offset + 2;
  if (size === 0x80) throw new Error('an indefinite DER length');
  if (size > 0x80) {
    const count = size - 0x80;
    if (count > 4) throw new Error('a DER length of more than 4 bytes');
    size = 0;
    for (let i = 0; i < count; i++) size = size * 256 + der[start + i];
    start += count;
  }
  const end = start + size;
  if (tag === undefined || Number.isNaN(end) || end > limit) {
    throw new Error('a truncated DER value');
  }
  return { tag, offset, start, end };
}

/** The TLVs a constructed TLV holds. */
function children(der, parent) {
  const out = [];
  for (let at = parent.start; at < parent.end; at = out[out.length - 1].end) {
    out.push(node(der, at, parent.end));
  }
  return out;
}

const content = (der, n) => der.slice(n.start, n.end);
const whole = (der, n) => der.slice(n.offset, n.end);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isOid = (der, n, dotted) => same(whole(der, n), oid(dotted));

/** The WebCrypto names of the curves an ECDSA key here may use. */
const CURVES = {
  'P-256': '1.2.840.10045.3.1.7',
  'P-384': '1.3.132.0.34',
};

/** A UTCTime or GeneralizedTime, in milliseconds. */
function timeOf(der, n) {
  let text = String.fromCharCode(...content(der, n));
  if (n.tag === 0x17) {
    text = `${Number(text.slice(0, 2)) < 50 ? '20' : '19'}${text}`;
  }
  const parts = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)Z$/.exec(text);
  if (!parts) throw new Error(`an unsupported certificate time: ${text}`);
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * What the edge reads in a certificate (DER): the issuer and subject names
 * and the public key as they are encoded, the validity, the curve of an EC
 * key (null for any other key), and the extensions.
 */
export function readCertificate(der) {
  const [tbs] = children(der, node(der, 0));
  const fields = children(der, tbs);
  const at = fields[0].tag === 0xa0 ? 1 : 0;
  const [issuer, validity, subject, spki] = fields.slice(at + 2, at + 6);
  const [notBefore, notAfter] = children(der, validity).map((t) =>
    timeOf(der, t),
  );
  const [keyType, parameters] = children(der, children(der, spki)[0]);
  let curve = null;
  if (isOid(der, keyType, OID.ecPublicKey) && parameters) {
    for (const name of Object.keys(CURVES)) {
      if (isOid(der, parameters, CURVES[name])) curve = name;
    }
  }
  const extensions = [];
  for (const field of fields.slice(at + 6)) {
    if (field.tag !== 0xa3) continue;
    for (const entry of children(der, children(der, field)[0])) {
      const parts = children(der, entry);
      extensions.push({
        id: whole(der, parts[0]),
        value: content(der, parts[parts.length - 1]),
      });
    }
  }
  return {
    issuer: whole(der, issuer),
    subject: whole(der, subject),
    notBefore,
    notAfter,
    spki: whole(der, spki),
    curve,
    extensions,
  };
}

/** The value of a certificate's extension `type` (DER), or null. */
function extensionOf(cert, type) {
  const id = oid(type);
  const found = cert.extensions.find((entry) => same(entry.id, id));
  return found ? found.value : null;
}

/** A certificate's subject key identifier, or null when it has none. */
export function subjectKeyId(cert) {
  const value = extensionOf(cert, OID.subjectKeyIdentifier);
  return value ? content(value, node(value, 0)) : null;
}

/** Whether a certificate is a CA that may sign certificates. */
function signsCertificates(cert) {
  const constraints = extensionOf(cert, OID.basicConstraints);
  if (!constraints) return false;
  const [isCa] = children(constraints, node(constraints, 0));
  if (!isCa || isCa.tag !== 0x01 || constraints[isCa.start] === 0) {
    return false;
  }
  const usage = extensionOf(cert, OID.keyUsage);
  if (!usage) return true;
  // keyCertSign is bit 5 of the key usage: 0x04 in its first byte.
  const bits = content(usage, node(usage, 0));
  return bits.length > 1 && (bits[1] & 0x04) !== 0;
}

/** The DNS names of a certificate's subjectAltName, in lower case. */
export function dnsNames(cert) {
  const value = extensionOf(cert, OID.subjectAltName);
  if (!value) return [];
  return children(value, node(value, 0))
    .filter((name) => name.tag === 0x82)
    .map((name) => String.fromCharCode(...content(value, name)).toLowerCase());
}

/**
 * A PEM private key as PKCS #8 (DER), the form WebCrypto imports: as it is,
 * or converted from the SEC 1 `EC PRIVATE KEY` that Go, and so Caddy,
 * writes. Null for any other key.
 */
export function pkcs8Of(text) {
  for (const block of pemBlocks(text)) {
    if (block.label === 'PRIVATE KEY') return block.der;
    if (block.label !== 'EC PRIVATE KEY') continue;
    const der = block.der;
    // ECPrivateKey: version, privateKey, [0] parameters, [1] publicKey. In
    // PKCS #8 the curve moves to the algorithm, as OpenSSL writes it.
    const parts = children(der, node(der, 0));
    const parameters = parts.find((part) => part.tag === 0xa0);
    if (!parameters) return null;
    const curve = whole(der, children(der, parameters)[0]);
    const key = seq(
      ...parts
        .filter((part) => part.tag !== 0xa0)
        .map((part) => whole(der, part)),
    );
    return seq(integer([0]), seq(oid(OID.ecPublicKey), curve), octets(key));
  }
  return null;
}

/**
 * Whether the private key `pkcs8` belongs to the public key `spki` (both
 * DER) on `curve`: what the one signs, the other verifies.
 */
export async function keyMatches(subtle, pkcs8, spki, curve) {
  const algorithm = { name: 'ECDSA', namedCurve: curve };
  const privateKey = await subtle.importKey(
    'pkcs8',
    Uint8Array.from(pkcs8),
    algorithm,
    false,
    ['sign'],
  );
  const publicKey = await subtle.importKey(
    'spki',
    Uint8Array.from(spki),
    algorithm,
    false,
    ['verify'],
  );
  const probe = Uint8Array.from(ascii('tale-proxy key check'));
  const signature = await subtle.sign(SIGN, privateKey, probe);
  return subtle.verify(SIGN, publicKey, signature, probe);
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
  const issuer = readCertificate(unpem(root.cert));
  const issuerId = subjectKeyId(issuer);
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
    issuer: issuer.subject,
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
 * The CA `candidate` (its PEM key and certificate) as this module keeps a
 * CA, when it can sign the leaves: a P-256 CA with a key identifier, valid
 * for longer than a leaf, whose key it holds. Otherwise the reason it
 * cannot.
 */
async function adoptable(subtle, candidate, now) {
  const block = pemBlocks(candidate.cert).find(
    (found) => found.label === 'CERTIFICATE',
  );
  if (!block) return { reason: 'it has no certificate' };
  const cert = readCertificate(block.der);
  if (!signsCertificates(cert)) return { reason: 'it is no CA certificate' };
  if (cert.curve !== 'P-256') return { reason: 'its key is not ECDSA P-256' };
  if (!subjectKeyId(cert)) return { reason: 'it has no key identifier' };
  if (cert.notBefore > now || cert.notAfter - now <= LEAF_DAYS * DAY) {
    return {
      reason: `it is valid from ${new Date(cert.notBefore).toISOString()} to ${new Date(cert.notAfter).toISOString()}`,
    };
  }
  const key = pkcs8Of(candidate.key);
  if (!key || !(await keyMatches(subtle, key, cert.spki, 'P-256'))) {
    return { reason: 'its private key does not belong to it' };
  }
  return {
    root: { key: pem('PRIVATE KEY', key), cert: pem('CERTIFICATE', block.der) },
  };
}

/**
 * Makes sure `dir` holds a CA and a current leaf for `hosts`. `io` reads a
 * file (null when absent) and writes one with a mode; the CA is made only
 * when it is absent, so a client that trusted it keeps trusting it. A CA
 * that `dir` lacks is `adopt` (`{key, cert, source}`, PEM) when that can
 * sign the leaves, since clients may trust it already, and a new one else.
 * Answers what it did, and the leaf's certificate and key.
 */
export async function ensureCertificates({
  dir,
  hosts,
  now,
  io,
  crypto,
  adopt = null,
}) {
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
    let found = { reason: null };
    if (adopt) {
      try {
        found = await adoptable(subtle, adopt, now);
      } catch (error) {
        found = { reason: `it cannot be read (${error.message})` };
      }
    }
    if (found.root) {
      root = found.root;
      actions.push(`adopted the local CA of ${adopt.source}`);
    } else {
      root = await issueRoot(subtle, random, now);
      actions.push(
        found.reason
          ? `created the local CA: the one of ${adopt.source} cannot sign, ${found.reason}`
          : 'created the local CA',
      );
    }
    io.write(paths.rootKey, root.key, 0o600);
    io.write(paths.rootCert, root.cert, 0o644);
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
