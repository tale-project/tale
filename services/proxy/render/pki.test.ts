import { describe, expect, it } from 'bun:test';
import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from 'node:crypto';

import { caddyCa, type KeyPair } from './caddy-fixture';
import { ensureCertificates, ipBytes, LEAF_DAYS, RENEW_DAYS } from './pki.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-02T00:00:00Z');

function memory() {
  const files = new Map<string, { text: string; mode: number }>();
  return {
    files,
    io: {
      read: (path: string) => files.get(path)?.text ?? null,
      write: (path: string, text: string, mode: number) =>
        files.set(path, { text, mode }),
    },
  };
}

const issue = (
  io: ReturnType<typeof memory>['io'],
  hosts: string[],
  now = NOW,
) => ensureCertificates({ dir: '/data/pki', hosts, now, io, crypto });

describe('ensureCertificates', () => {
  it('makes a CA and a server leaf for every host, which verify', async () => {
    const { files, io } = memory();
    const result = await issue(io, [
      'tale.example.com',
      'docs.localhost',
      '10.0.0.5',
      '2001:db8::1',
    ]);
    expect(result.actions).toEqual([
      'created the local CA',
      'issued a leaf for tale.example.com, docs.localhost, 10.0.0.5, 2001:db8::1',
    ]);

    const root = new X509Certificate(
      files.get('/data/pki/root.crt')?.text ?? '',
    );
    const leaf = new X509Certificate(result.cert);
    expect(root.ca).toBe(true);
    expect(root.subject).toBe('O=Tale\nCN=Tale Local CA');
    expect(leaf.ca).toBe(false);
    expect(leaf.checkIssued(root)).toBe(true);
    expect(leaf.verify(root.publicKey)).toBe(true);
    expect(leaf.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1']);
    expect(leaf.subjectAltName).toBe(
      'DNS:tale.example.com, DNS:docs.localhost, IP Address:10.0.0.5, IP Address:2001:DB8:0:0:0:0:0:1',
    );
    expect(leaf.checkHost('docs.localhost')).toBe('docs.localhost');
    expect(Date.parse(leaf.validTo)).toBe(
      Math.floor((NOW + LEAF_DAYS * DAY) / 1000) * 1000,
    );
    expect(Date.parse(root.validTo) - NOW).toBeGreaterThan(9 * 365 * DAY);

    expect(files.get('/data/pki/root.key')?.mode).toBe(0o600);
    expect(files.get('/data/pki/leaf.key')?.mode).toBe(0o600);
    expect(files.get('/data/pki/root.crt')?.mode).toBe(0o644);
    expect(result.key).toBe(files.get('/data/pki/leaf.key')?.text ?? '');
  });

  it('keeps a current leaf, and the CA when the leaf is reissued', async () => {
    const { files, io } = memory();
    const first = await issue(io, ['tale.example.com']);
    const rootBefore = files.get('/data/pki/root.crt')?.text;

    const again = await issue(io, ['tale.example.com'], NOW + 100 * DAY);
    expect(again.actions).toEqual([]);
    expect(again.cert).toBe(first.cert);

    const nearEnd = await issue(
      io,
      ['tale.example.com'],
      NOW + (LEAF_DAYS - RENEW_DAYS + 1) * DAY,
    );
    expect(nearEnd.actions).toEqual(['issued a leaf for tale.example.com']);
    expect(nearEnd.cert).not.toBe(first.cert);

    const moreHosts = await issue(
      io,
      ['tale.example.com', 'tale.example.org'],
      NOW + (LEAF_DAYS - RENEW_DAYS + 2) * DAY,
    );
    expect(moreHosts.actions).toEqual([
      'issued a leaf for tale.example.com, tale.example.org',
    ]);
    expect(files.get('/data/pki/root.crt')?.text).toBe(rootBefore);
    expect(
      new X509Certificate(moreHosts.cert).checkIssued(
        new X509Certificate(rootBefore ?? ''),
      ),
    ).toBe(true);
  });

  it('reissues the leaf when its state is unreadable', async () => {
    const { files, io } = memory();
    await issue(io, ['tale.example.com']);
    files.set('/data/pki/leaf.json', { text: '{', mode: 0o644 });
    const result = await issue(io, ['tale.example.com']);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[1]).toBe('issued a leaf for tale.example.com');
  });
});

describe('ensureCertificates with a CA to adopt', () => {
  // OpenSSL dates the fixtures from the clock, so these runs do too.
  const adopting = (
    io: ReturnType<typeof memory>['io'],
    adopt: KeyPair,
    now = Date.now(),
  ) =>
    ensureCertificates({
      dir: '/data/pki',
      hosts: ['tale.example.com'],
      now,
      io,
      crypto,
      adopt: { ...adopt, source: 'the Caddy proxy' },
    });

  it("adopts the Caddy edge's CA, so who trusts it trusts the leaf", async () => {
    const { files, io } = memory();
    const caddy = caddyCa();
    const result = await adopting(io, caddy);
    expect(result.actions).toEqual([
      'adopted the local CA of the Caddy proxy',
      'issued a leaf for tale.example.com',
    ]);

    const root = new X509Certificate(caddy.cert);
    const kept = files.get('/data/pki/root.crt')?.text ?? '';
    expect(new X509Certificate(kept).fingerprint256).toBe(root.fingerprint256);
    const key = files.get('/data/pki/root.key');
    expect(key?.mode).toBe(0o600);
    expect(key?.text).toStartWith('-----BEGIN PRIVATE KEY-----\n');
    expect(
      createPublicKey(createPrivateKey(key?.text ?? '')).export({
        type: 'spki',
        format: 'der',
      }),
    ).toEqual(root.publicKey.export({ type: 'spki', format: 'der' }));

    const leaf = new X509Certificate(result.cert);
    expect(leaf.issuer).toBe(root.subject);
    expect(leaf.checkIssued(root)).toBe(true);
    expect(leaf.verify(root.publicKey)).toBe(true);
    expect(leaf.checkHost('tale.example.com')).toBe('tale.example.com');
  });

  it('keeps the CA it has, whatever it is offered', async () => {
    const { files, io } = memory();
    const now = Date.now();
    await issue(io, ['tale.example.com'], now);
    const rootBefore = files.get('/data/pki/root.crt')?.text;

    const result = await adopting(io, caddyCa(), now + DAY);
    expect(result.actions).toEqual([]);
    expect(files.get('/data/pki/root.crt')?.text).toBe(rootBefore);
  });

  it('creates a CA when the offered one cannot sign, and says why', async () => {
    const valid = caddyCa();
    const cases: [KeyPair, string][] = [
      [
        { key: valid.key, cert: caddyCa().cert },
        'its private key does not belong to it',
      ],
      [
        { key: 'no key', cert: valid.cert },
        'its private key does not belong to it',
      ],
      [caddyCa({ curve: 'secp384r1' }), 'its key is not ECDSA P-256'],
      [
        caddyCa({ extensions: ['basicConstraints=critical,CA:FALSE'] }),
        'it is no CA certificate',
      ],
      [
        caddyCa({
          extensions: [
            'basicConstraints=critical,CA:TRUE',
            'keyUsage=critical,digitalSignature',
          ],
        }),
        'it is no CA certificate',
      ],
      [
        caddyCa({
          extensions: [
            'basicConstraints=critical,CA:TRUE',
            'subjectKeyIdentifier=none',
            'authorityKeyIdentifier=none',
          ],
        }),
        'it has no key identifier',
      ],
      [caddyCa({ days: LEAF_DAYS }), 'it is valid from '],
      [{ key: valid.key, cert: 'no certificate' }, 'it has no certificate'],
      [
        {
          key: valid.key,
          cert: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
        },
        'it cannot be read (',
      ],
    ];
    for (const [adopt, reason] of cases) {
      const { files, io } = memory();
      const result = await adopting(io, adopt);
      expect(result.actions[0]).toStartWith(
        `created the local CA: the one of the Caddy proxy cannot sign, ${reason}`,
      );
      const root = new X509Certificate(
        files.get('/data/pki/root.crt')?.text ?? '',
      );
      expect(root.subject).toBe('O=Tale\nCN=Tale Local CA');
      expect(new X509Certificate(result.cert).checkIssued(root)).toBe(true);
    }
  });
});

describe('ipBytes', () => {
  it('reads IPv4 and IPv6 literals and leaves hostnames', () => {
    expect(ipBytes('10.0.0.5')).toEqual([10, 0, 0, 5]);
    expect(ipBytes('::1')).toEqual([...new Array(15).fill(0), 1]);
    expect(ipBytes('2001:db8::1')).toEqual([
      0x20,
      0x01,
      0x0d,
      0xb8,
      ...new Array(11).fill(0),
      1,
    ]);
    expect(ipBytes('::ffff:192.0.2.1')).toEqual([
      ...new Array(10).fill(0),
      0xff,
      0xff,
      192,
      0,
      2,
      1,
    ]);
    expect(ipBytes('tale.example.com')).toBeNull();
    expect(ipBytes('300.1.1.1')).toBeNull();
    expect(ipBytes('1::2::3')).toBeNull();
  });
});
