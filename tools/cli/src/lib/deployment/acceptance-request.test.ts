import { expect, test } from 'bun:test';

import { acceptanceHttpProbe } from './acceptance-test-helper';

for (const mode of [
  'tls',
  'proxy',
  'redirect',
  'missing',
  'oversized',
  'stalled',
  'duplicate',
])
  test.skipIf(mode === 'tls' && process.platform === 'win32')(
    `actual ${mode} transport preserves its trust and response bounds in an isolated process`,
    async () => {
      const result = await acceptanceHttpProbe(mode);
      expect(result.success, result.stderr).toBe(true);
      expect(result.stdout).toBe('accepted');
      expect(result.pid).not.toBe(process.pid);
    },
    35_000,
  );
