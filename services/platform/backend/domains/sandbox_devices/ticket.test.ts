// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { mintDeviceTicket } from './ticket.ts';

describe('mintDeviceTicket', () => {
  // The spawner's hub (services/sandbox/src/devices/ticket.test.ts) verifies
  // the SAME vector: a drift on either side fails one of the two suites.
  it('matches the cross-service parity vector', () => {
    expect(
      mintDeviceTicket(
        {
          deviceId: '5c0a6d2e-1f3b-4b7a-9d7e-2f1c3a4b5d6e',
          organizationId: 'org_test_1',
          issuedAtMs: 1_790_000_000_000,
          expiresAtMs: 1_790_000_900_000,
        },
        'parity-test-token',
      ),
    ).toBe(
      'tdt1.eyJkIjoiNWMwYTZkMmUtMWYzYi00YjdhLTlkN2UtMmYxYzNhNGI1ZDZlIiwibyI6Im9yZ190ZXN0XzEiLCJpIjoxNzkwMDAwMDAwMDAwLCJlIjoxNzkwMDAwOTAwMDAwfQ.8b4700b0230a560cb0192a9fd36a41954d58bac99cb14d714252e96578adc332',
    );
  });
});
