import { describe, expect, it } from 'vitest';

import { getClientIp, nodePeerAddress } from './client_ip';

const DEFAULT_TRUST = ['loopback', 'uniquelocal'];

function h(entries: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(entries)) headers.set(k, v);
  return headers;
}

describe('getClientIp', () => {
  it("returns 'unknown' when no headers are present", () => {
    expect(getClientIp(new Headers(), DEFAULT_TRUST)).toBe('unknown');
  });

  it('returns a single-entry x-forwarded-for', () => {
    expect(
      getClientIp(h({ 'x-forwarded-for': '203.0.113.1' }), DEFAULT_TRUST),
    ).toBe('203.0.113.1');
  });

  it('skips trusted CIDRs from the right and returns first untrusted hop', () => {
    // Caddy (127.0.0.1) → internal (10.0.0.5) → real client (203.0.113.1)
    expect(
      getClientIp(
        h({ 'x-forwarded-for': '203.0.113.1, 10.0.0.5, 127.0.0.1' }),
        DEFAULT_TRUST,
      ),
    ).toBe('203.0.113.1');
  });

  it('defends against spoofed leftmost entry', () => {
    // Client sends evil header; proxy appends its real IP; proxy-addr
    // must still return the PROXY's view of the client, not the spoof.
    expect(
      getClientIp(
        h({ 'x-forwarded-for': 'evil.spoof, 203.0.113.1, 10.0.0.5' }),
        DEFAULT_TRUST,
      ),
    ).toBe('203.0.113.1');
  });

  it('respects a custom CIDR trust list', () => {
    // If we trust 203.0.113.0/24 (e.g. a Cloudflare-style edge), the
    // real client should be whatever comes before it.
    expect(
      getClientIp(h({ 'x-forwarded-for': '198.51.100.77, 203.0.113.7' }), [
        'loopback',
        '203.0.113.0/24',
      ]),
    ).toBe('198.51.100.77');
  });

  it('handles IPv6 addresses', () => {
    expect(
      getClientIp(h({ 'x-forwarded-for': '2001:db8::1' }), DEFAULT_TRUST),
    ).toBe('2001:db8::1');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(h({ 'x-real-ip': '198.51.100.7' }), DEFAULT_TRUST)).toBe(
      '198.51.100.7',
    );
  });

  it('prefers x-forwarded-for over x-real-ip when both exist', () => {
    expect(
      getClientIp(
        h({
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '198.51.100.7',
        }),
        DEFAULT_TRUST,
      ),
    ).toBe('203.0.113.1');
  });

  it("returns 'unknown' for an empty x-forwarded-for value", () => {
    expect(getClientIp(h({ 'x-forwarded-for': '' }), DEFAULT_TRUST)).toBe(
      'unknown',
    );
  });
});

/**
 * With the real TCP peer in hand the walk starts at the socket: an
 * untrusted peer IS the client and its forwarded headers are never read,
 * so a backend reached without the deployment's proxy cannot be fed a
 * forged chain. A trusted peer (the proxy) hands the walk to its chain.
 */
describe('getClientIp with the TCP peer', () => {
  it('ignores every forwarded header when the peer itself is untrusted', () => {
    expect(
      getClientIp(
        h({
          'x-forwarded-for': '198.51.100.9, 10.0.0.5',
          'x-real-ip': '198.51.100.9',
        }),
        DEFAULT_TRUST,
        { peer: '203.0.113.5' },
      ),
    ).toBe('203.0.113.5');
  });

  it('returns an untrusted peer that forwarded nothing', () => {
    expect(
      getClientIp(new Headers(), DEFAULT_TRUST, { peer: '203.0.113.5' }),
    ).toBe('203.0.113.5');
  });

  it('walks the chain the trusted proxy peer forwarded, past a spoofed head', () => {
    // Caddy (172.18.0.2, uniquelocal) → the client is the rightmost hop
    // no trusted proxy claims; the leftmost entry is the client's own claim.
    expect(
      getClientIp(
        h({ 'x-forwarded-for': 'evil.spoof, 203.0.113.1' }),
        DEFAULT_TRUST,
        { peer: '172.18.0.2' },
      ),
    ).toBe('203.0.113.1');
  });

  it('falls back to x-real-ip when the trusted peer forwarded no chain', () => {
    expect(
      getClientIp(h({ 'x-real-ip': '198.51.100.7' }), DEFAULT_TRUST, {
        peer: '172.18.0.2',
      }),
    ).toBe('198.51.100.7');
  });

  it("answers 'unknown' for a trusted peer with no forwarded information", () => {
    expect(
      getClientIp(new Headers(), DEFAULT_TRUST, { peer: '10.0.0.5' }),
    ).toBe('unknown');
  });

  it('spells an IPv4-mapped IPv6 peer as plain IPv4', () => {
    expect(
      getClientIp(new Headers(), DEFAULT_TRUST, { peer: '::ffff:203.0.113.5' }),
    ).toBe('203.0.113.5');
  });

  it('honours a custom trust list against the peer', () => {
    // A public edge (203.0.113.7) trusted explicitly: the walk continues
    // into its chain; the same peer untrusted is the client.
    const headers = h({ 'x-forwarded-for': '198.51.100.77' });
    expect(
      getClientIp(headers, ['loopback', '203.0.113.0/24'], {
        peer: '203.0.113.7',
      }),
    ).toBe('198.51.100.77');
    expect(getClientIp(headers, DEFAULT_TRUST, { peer: '203.0.113.7' })).toBe(
      '203.0.113.7',
    );
  });
});

describe('nodePeerAddress', () => {
  it('reads the node-server binding', () => {
    expect(
      nodePeerAddress({ incoming: { socket: { remoteAddress: '10.1.2.3' } } }),
    ).toBe('10.1.2.3');
  });

  it('yields undefined for any other runtime env', () => {
    expect(nodePeerAddress(undefined)).toBeUndefined();
    expect(nodePeerAddress({})).toBeUndefined();
    expect(nodePeerAddress({ incoming: { socket: {} } })).toBeUndefined();
    expect(
      nodePeerAddress({ incoming: { socket: { remoteAddress: '' } } }),
    ).toBeUndefined();
  });
});
