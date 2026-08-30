import { describe, expect, it } from 'vitest';

import {
  BUNDLED_OBJECT_STORE_BUCKET,
  resolveBundledObjectStore,
} from './bundled-object-store';

/**
 * The gate on the deployment's blob backend. S3 is the ONLY blob backend, so
 * this decides whether a deployment can accept an upload at all — a half
 * answer here is a stack that boots fine and 503s on the first file.
 */

const FULL = {
  OBJECT_STORE_ENDPOINT: 'http://object-store:9000',
  OBJECT_STORE_ACCESS_KEY: 'tale',
  OBJECT_STORE_SECRET_KEY: 'secret',
};

describe('resolveBundledObjectStore', () => {
  it('resolves a complete configuration, defaulting bucket and region', () => {
    const result = resolveBundledObjectStore(FULL);
    expect(result.configured).toBe(true);
    if (!result.configured) return;
    expect(result.store.bucket).toBe(BUNDLED_OBJECT_STORE_BUCKET);
    expect(result.store.region).toBe('us-east-1');
    expect(result.store.endpoint).toBe('http://object-store:9000');
  });

  it('takes an explicit bucket and region over the defaults', () => {
    const result = resolveBundledObjectStore({
      ...FULL,
      OBJECT_STORE_BUCKET: 'blobs',
      OBJECT_STORE_REGION: 'eu-central-1',
    });
    expect(result.configured && result.store.bucket).toBe('blobs');
    expect(result.configured && result.store.region).toBe('eu-central-1');
  });

  it('trims the trailing slash so keys are not double-separated', () => {
    const result = resolveBundledObjectStore({
      ...FULL,
      OBJECT_STORE_ENDPOINT: 'http://object-store:9000/',
    });
    expect(result.configured && result.store.endpoint).toBe(
      'http://object-store:9000',
    );
  });

  it('is unconfigured with no endpoint — the deployment fails closed', () => {
    const { OBJECT_STORE_ENDPOINT: _drop, ...rest } = FULL;
    const result = resolveBundledObjectStore(rest);
    expect(result.configured).toBe(false);
    expect(!result.configured && result.reason).toContain(
      'OBJECT_STORE_ENDPOINT',
    );
  });

  it.each([['OBJECT_STORE_ACCESS_KEY'], ['OBJECT_STORE_SECRET_KEY']])(
    'refuses a half-configured store (%s missing)',
    (key) => {
      const env: Record<string, string | undefined> = { ...FULL };
      delete env[key];
      const result = resolveBundledObjectStore(env);
      // Half a credential signs requests with no key and fails at the first
      // upload; saying so at boot beats discovering it in the UI.
      expect(result.configured).toBe(false);
      expect(!result.configured && result.reason).toContain('both required');
    },
  );

  it.each([['not-a-url'], ['file:///etc/passwd'], ['ftp://store/bucket']])(
    'refuses a non-http endpoint (%s)',
    (endpoint) => {
      const result = resolveBundledObjectStore({
        ...FULL,
        OBJECT_STORE_ENDPOINT: endpoint,
      });
      expect(result.configured).toBe(false);
    },
  );
});
