import { describe, expect, it } from 'vitest';

import { ensureWebdavHmacKey, WEBDAV_HMAC_KEY_MIN_LENGTH } from './hmac-key';

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
