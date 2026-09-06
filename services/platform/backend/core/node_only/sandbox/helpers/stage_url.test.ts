import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stageUrlForBlobRef } from './stage_url';

const HMAC_KEY = 'WEBDAV_APP_PASSWORD_HMAC_KEY';

describe('stageUrlForBlobRef', () => {
  const previous = process.env[HMAC_KEY];

  beforeEach(() => {
    process.env[HMAC_KEY] = 'a'.repeat(64);
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[HMAC_KEY];
    else process.env[HMAC_KEY] = previous;
    vi.restoreAllMocks();
  });

  it('stages an s3: ref through the token-gated sandbox-blob route', async () => {
    const url = await stageUrlForBlobRef('s3:acme/blob-1', 'org_1');
    expect(url).not.toBeNull();
    const parsed = new URL(url ?? '');
    expect(parsed.pathname).toBe('/api/sandbox-blob');
    expect(parsed.searchParams.get('token')).toMatch(/^v1\./);
  });

  // Regression: a Convex-era `_storage` id used to reach `ctx.storage.getUrl`,
  // which the 0.5 shim refuses with a throw — so one legacy ref among a run's
  // inputs failed the whole turn instead of being skipped as documented.
  it('answers null (and warns) for a legacy _storage id instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(stageUrlForBlobRef('kg2abc123', 'org_1')).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('kg2abc123');
  });

  it('answers null when the deployment has no HMAC root to sign with', async () => {
    delete process.env[HMAC_KEY];
    await expect(
      stageUrlForBlobRef('s3:acme/blob-1', 'org_1'),
    ).resolves.toBeNull();
  });
});
