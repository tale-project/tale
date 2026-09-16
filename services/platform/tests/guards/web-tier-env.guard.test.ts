// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ENV_SH = fileURLToPath(new URL('../../env.sh', import.meta.url));

// Source the real env.sh the web role runs, normalize, and print the one
// variable under test. SITE_URL and DB_PASSWORD are the minimum
// env_normalize_common insists on before it gets that far.
function normalizedBackendUrl(extra: Record<string, string>): string {
  const result = spawnSync(
    '/bin/bash',
    [
      '-c',
      'source "$ENV_SH" && env_normalize_common && printf "%s" "$TALE_BACKEND_URL"',
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        ENV_SH,
        SITE_URL: 'https://tale.example',
        DB_PASSWORD: 'not-a-secret',
        ...extra,
      },
      encoding: 'utf8',
      timeout: 5000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

/**
 * The web tier asks the application backend for the public /status verdicts
 * and for the answers only a database can give, at TALE_BACKEND_URL. The
 * in-code default is the host-dev loopback, which nothing serves inside the
 * platform container, so a compose file that left the variable unset showed
 * "Service outage" on a healthy stack. env.sh must default it to the
 * in-compose alias, exactly like SANDBOX_URL, and still honour an explicit
 * value.
 */
describe('web-tier env.sh: TALE_BACKEND_URL', () => {
  it('defaults to the in-compose backend alias when unset', () => {
    expect(normalizedBackendUrl({})).toBe('http://backend-api:3005');
  });

  it('treats an empty value as unset', () => {
    expect(normalizedBackendUrl({ TALE_BACKEND_URL: '' })).toBe(
      'http://backend-api:3005',
    );
  });

  it('keeps an explicit value for a differently named backend service', () => {
    expect(
      normalizedBackendUrl({ TALE_BACKEND_URL: 'http://api.internal:3005' }),
    ).toBe('http://api.internal:3005');
  });
});
