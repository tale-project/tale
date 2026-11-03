import { describe, expect, it } from 'vitest';

import { proxy, proxyCheck } from '@/tests/utils/fixtures';

import { isChecking } from './health';

describe('isChecking', () => {
  it('is true only while a check of the proxy runs', () => {
    expect(
      isChecking(proxy({ check: proxyCheck({ status: 'checking' }) })),
    ).toBe(true);
    for (const status of ['ok', 'failed', 'unchecked'] as const) {
      expect(isChecking(proxy({ check: proxyCheck({ status }) }))).toBe(false);
    }
  });
});
