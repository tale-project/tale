import { describe, expect, it } from 'bun:test';
import { X509Certificate } from 'node:crypto';

import { caddyCa, type KeyPair, serverCert } from './caddy-fixture';
import { caddyAcme, caddyRoot } from './caddy.js';

const DAY = 24 * 60 * 60 * 1000;
const DIR = '/caddy-data';
const LOCAL_CA = `${DIR}/caddy/pki/authorities/local`;
const LETS_ENCRYPT = `${DIR}/caddy/certificates/acme-v02.api.letsencrypt.org-directory`;

/** A Caddy data volume holding `files`. */
const volume = (files: Record<string, string>) => ({
  read: (path: string) => files[path] ?? null,
});

/** The files Caddy keeps for a certificate it got from Let's Encrypt. */
const stored = (host: string, pair: KeyPair) => ({
  [`${LETS_ENCRYPT}/${host}/${host}.crt`]: pair.cert,
  [`${LETS_ENCRYPT}/${host}/${host}.key`]: pair.key,
  [`${LETS_ENCRYPT}/${host}/${host}.json`]: '{}',
});

// Stands in for Let's Encrypt's intermediate.
const issuer = caddyCa();

// OpenSSL dates the fixtures from the clock, so these runs do too.
const carry = (
  files: Record<string, string>,
  hosts: string[],
  now = Date.now(),
) =>
  caddyAcme({
    dir: DIR,
    hosts,
    resolver: 'letsencrypt',
    now,
    io: volume(files),
    crypto,
  });

describe('caddyRoot', () => {
  it('finds the local CA the Caddy edge made, or nothing', () => {
    const ca = caddyCa();
    expect(
      caddyRoot({
        dir: DIR,
        io: volume({
          [`${LOCAL_CA}/root.key`]: ca.key,
          [`${LOCAL_CA}/root.crt`]: ca.cert,
        }),
      }),
    ).toEqual({ key: ca.key, cert: ca.cert, source: 'the Caddy proxy' });
    expect(
      caddyRoot({
        dir: DIR,
        io: volume({ [`${LOCAL_CA}/root.crt`]: ca.cert }),
      }),
    ).toBeNull();
    expect(caddyRoot({ dir: DIR, io: volume({}) })).toBeNull();
  });
});

describe('caddyAcme', () => {
  it("stores each host's certificate as Traefik stores the ones it orders", async () => {
    const app = serverCert(issuer, ['tale.example.com']);
    const docs = serverCert(issuer, ['docs.example.com', 'www.example.com']);
    const result = await carry(
      {
        ...stored('tale.example.com', app),
        ...stored('docs.example.com', docs),
      },
      ['tale.example.com', 'docs.example.com', 'new.example.com'],
    );
    expect(result.actions).toEqual([
      'took over the certificate of the Caddy proxy for tale.example.com',
      'took over the certificate of the Caddy proxy for docs.example.com',
    ]);

    const resolver = result.storage?.letsencrypt;
    expect(Object.keys(result.storage ?? {})).toEqual(['letsencrypt']);
    expect(resolver?.Account).toBeNull();
    const decode = (base64: string) =>
      Buffer.from(base64, 'base64').toString('utf8');
    expect(
      resolver?.Certificates.map((entry) => ({
        ...entry,
        certificate: decode(entry.certificate),
        key: decode(entry.key),
      })),
    ).toEqual([
      {
        domain: { main: 'tale.example.com' },
        certificate: app.cert,
        key: app.key,
        Store: 'default',
      },
      {
        domain: { main: 'docs.example.com' },
        certificate: docs.cert,
        key: docs.key,
        Store: 'default',
      },
    ]);
    // The chain comes along: the leaf first, then its issuer.
    const leaf = new X509Certificate(
      decode(resolver?.Certificates[0]?.certificate ?? ''),
    );
    expect(leaf.checkHost('tale.example.com')).toBe('tale.example.com');
    expect(leaf.checkIssued(new X509Certificate(issuer.cert))).toBe(true);
  });

  it('leaves a certificate it cannot serve, and says why', async () => {
    const host = 'tale.example.com';
    const valid = serverCert(issuer, [host]);
    const cases: [KeyPair, string, number?][] = [
      [serverCert(issuer, ['other.example.com']), 'it does not name the host'],
      [valid, 'it ended on ', Date.now() + 100 * DAY],
      [
        { cert: valid.cert, key: serverCert(issuer, [host]).key },
        'its private key does not belong to it',
      ],
      [{ cert: valid.cert, key: 'no key' }, 'its key is no EC key'],
      [{ cert: issuer.key, key: valid.key }, 'it has no certificate'],
      [
        {
          cert: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n',
          key: valid.key,
        },
        'it cannot be read (',
      ],
    ];
    for (const [pair, reason, now] of cases) {
      const result = await carry(stored(host, pair), [host], now);
      expect(result.storage).toBeNull();
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0]).toStartWith(
        `left the certificate of the Caddy proxy for ${host}: ${reason}`,
      );
    }
  });

  it('answers nothing when the volume holds no certificate', async () => {
    expect(await carry({}, ['tale.example.com'])).toEqual({
      storage: null,
      actions: [],
    });
  });
});
