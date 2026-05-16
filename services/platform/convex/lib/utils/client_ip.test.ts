import { describe, expect, it } from 'vitest';

import { getClientIp } from './client_ip';

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
