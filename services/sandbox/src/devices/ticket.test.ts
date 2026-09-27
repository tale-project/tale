import { describe, expect, test } from 'bun:test';

import { mintDeviceTicket, verifyDeviceTicket } from './ticket.ts';

// The platform's minter (backend/domains/sandbox_devices/ticket.test.ts) pins
// the SAME vector: a drift on either side fails one of the two suites.
const PARITY_TOKEN = 'parity-test-token';
const PARITY_CLAIMS = {
  deviceId: '5c0a6d2e-1f3b-4b7a-9d7e-2f1c3a4b5d6e',
  organizationId: 'org_test_1',
  issuedAtMs: 1_790_000_000_000,
  expiresAtMs: 1_790_000_900_000,
};
const PARITY_TICKET =
  'tdt1.eyJkIjoiNWMwYTZkMmUtMWYzYi00YjdhLTlkN2UtMmYxYzNhNGI1ZDZlIiwibyI6Im9yZ190ZXN0XzEiLCJpIjoxNzkwMDAwMDAwMDAwLCJlIjoxNzkwMDAwOTAwMDAwfQ.8b4700b0230a560cb0192a9fd36a41954d58bac99cb14d714252e96578adc332';

describe('device tickets', () => {
  test('mint matches the cross-service parity vector', () => {
    expect(mintDeviceTicket(PARITY_CLAIMS, PARITY_TOKEN)).toBe(PARITY_TICKET);
  });

  test('a fresh ticket verifies to its claims', () => {
    expect(
      verifyDeviceTicket(PARITY_TICKET, PARITY_TOKEN, 1_790_000_000_500),
    ).toEqual({ ok: true, ticket: PARITY_CLAIMS });
  });

  test('an expired ticket is refused', () => {
    expect(
      verifyDeviceTicket(PARITY_TICKET, PARITY_TOKEN, 1_790_000_900_000),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  test('a ticket signed with another deployment token is refused', () => {
    expect(
      verifyDeviceTicket(PARITY_TICKET, 'another-token', 1_790_000_000_500),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('a tampered payload no longer matches its signature', () => {
    const [prefix, , sig] = PARITY_TICKET.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        d: PARITY_CLAIMS.deviceId,
        o: 'someone_elses_org',
        i: PARITY_CLAIMS.issuedAtMs,
        e: PARITY_CLAIMS.expiresAtMs,
      }),
    ).toString('base64url');
    expect(
      verifyDeviceTicket(
        `${prefix}.${forged}.${sig}`,
        PARITY_TOKEN,
        1_790_000_000_500,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  test('malformed shapes and over-long lifetimes are refused', () => {
    for (const bad of ['', 'tdt1', 'tdt1.x', 'jwt.a.b', 'tdt1.a.b.c']) {
      expect(verifyDeviceTicket(bad, PARITY_TOKEN).ok).toBe(false);
    }
    const tooLong = mintDeviceTicket(
      {
        ...PARITY_CLAIMS,
        expiresAtMs: PARITY_CLAIMS.issuedAtMs + 2 * 3600_000,
      },
      PARITY_TOKEN,
    );
    expect(
      verifyDeviceTicket(tooLong, PARITY_TOKEN, PARITY_CLAIMS.issuedAtMs + 1),
    ).toEqual({ ok: false, reason: 'malformed' });
  });
});
