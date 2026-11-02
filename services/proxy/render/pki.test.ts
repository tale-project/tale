import { describe, expect, it } from 'bun:test';
import { X509Certificate } from 'node:crypto';

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
