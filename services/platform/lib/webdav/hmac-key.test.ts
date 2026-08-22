import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ensureWebdavHmacKey, WEBDAV_HMAC_KEY_MIN_LENGTH } from './hmac-key';

const hasSha256sum = (() => {
  try {
    execFileSync('sh', ['-c', 'command -v sha256sum'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('ensureWebdavHmacKey', () => {
  it('returns an explicit key unchanged and does not derive', () => {
    const env = {
      WEBDAV_APP_PASSWORD_HMAC_KEY: 'explicit-operator-key',
      INSTANCE_SECRET: 'should-be-ignored',
    } as unknown as NodeJS.ProcessEnv;
    expect(ensureWebdavHmacKey(env)).toBe('explicit-operator-key');
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe('explicit-operator-key');
  });

  it('derives from INSTANCE_SECRET and caches it onto env', () => {
    const env = {
      INSTANCE_SECRET: 'test-instance-secret',
    } as unknown as NodeJS.ProcessEnv;
    const key = ensureWebdavHmacKey(env);
    // Pinned against docker-entrypoint.sh's `printf '%s' "<secret>:webdav-hmac:v1" | sha256sum`.
    // If this vector changes, the platform (verify) and Convex (hash) sides
    // will disagree and ALL app-password auth will fail. Keep in lockstep.
    expect(key).toBe(
      '4cb5742e89373c2d7dd4a564dcf993d640cead7fae07caa01367c77f0f21ec1d',
    );
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBe(key);
    expect(key).toHaveLength(WEBDAV_HMAC_KEY_MIN_LENGTH);
  });

  it('returns undefined when neither an explicit key nor INSTANCE_SECRET is set', () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(ensureWebdavHmacKey(env)).toBeUndefined();
    expect(env.WEBDAV_APP_PASSWORD_HMAC_KEY).toBeUndefined();
  });
});

// The WebDAV HMAC key is derived in THREE places that MUST agree byte-for-byte,
// or an app-password hashed in one launch scenario fails to verify in another:
//   - docker-entrypoint.sh (tale-deploy / docker-compose):
//       printf '%s' "${INSTANCE_SECRET}:webdav-hmac:v1" | sha256sum
//   - scripts/dev.ts (tale-start / bun-dev): createHash('sha256').update(...)
//   - lib/webdav/hmac-key.ts ensureWebdavHmacKey() (the platform verify gate)
// The pinned vector above guards (3) against silent change; this proves (3)
// equals the actual prod shell pipeline (1) and the dev.ts formula (2).
describe('HMAC key derivation parity across launch scenarios', () => {
  it.runIf(hasSha256sum)(
    'shell sha256sum == ensureWebdavHmacKey == dev.ts createHash',
    () => {
      const secret = 'parity-vector-1234567890abcdef';
      const message = `${secret}:webdav-hmac:v1`;

      // (1) The exact docker-entrypoint.sh pipeline.
      const shellHash = execFileSync('sh', [
        '-c',
        `printf '%s' "${message}" | sha256sum`,
      ])
        .toString()
        .trim()
        .split(/\s+/)[0];

      // (2) The platform verify-side derivation.
      const ensured = ensureWebdavHmacKey({
        INSTANCE_SECRET: secret,
      });

      // (3) The scripts/dev.ts orchestrator derivation, inlined verbatim.
      const devTs = createHash('sha256').update(message).digest('hex');

      expect(ensured).toBe(shellHash);
      expect(devTs).toBe(shellHash);
    },
  );
});
