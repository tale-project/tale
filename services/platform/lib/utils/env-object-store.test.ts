import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OBJECT_STORE_BUCKET,
  resolveEnvObjectStore,
} from './env-object-store';

/**
 * The gate on the deployment's blob backend. S3 is the ONLY blob backend, so
 * this decides whether a deployment can accept an upload at all — a half
 * answer here is a stack that boots fine and 503s on the first file.
 */

const KEYS = {
  OBJECT_STORE_ACCESS_KEY: 'tale',
  OBJECT_STORE_SECRET_KEY: 'secret',
};

const SELF_HOSTED = {
  ...KEYS,
  OBJECT_STORE_ENDPOINT: 'http://object-store:9000',
};

describe('resolveEnvObjectStore', () => {
  it('resolves a self-hosted store, defaulting bucket and region', () => {
    const result = resolveEnvObjectStore(SELF_HOSTED);
    expect(result.configured).toBe(true);
    if (!result.configured) return;
    expect(result.store.bucket).toBe(DEFAULT_OBJECT_STORE_BUCKET);
    expect(result.store.region).toBe('us-east-1');
    expect(result.store.endpoint).toBe('http://object-store:9000');
  });

  it('takes an explicit bucket and region over the defaults', () => {
    const result = resolveEnvObjectStore({
      ...SELF_HOSTED,
      OBJECT_STORE_BUCKET: 'blobs',
      OBJECT_STORE_REGION: 'eu-central-1',
    });
    expect(result.configured && result.store.bucket).toBe('blobs');
    expect(result.configured && result.store.region).toBe('eu-central-1');
  });

  it('trims the trailing slash so keys are not double-separated', () => {
    const result = resolveEnvObjectStore({
      ...SELF_HOSTED,
      OBJECT_STORE_ENDPOINT: 'http://object-store:9000/',
    });
    expect(result.configured && result.store.endpoint).toBe(
      'http://object-store:9000',
    );
  });

  it.each([['OBJECT_STORE_ACCESS_KEY'], ['OBJECT_STORE_SECRET_KEY']])(
    'refuses a half-configured store (%s missing)',
    (key) => {
      const env: Record<string, string | undefined> = { ...SELF_HOSTED };
      delete env[key];
      const result = resolveEnvObjectStore(env);
      // Half a credential signs requests with no key and fails at the first
      // upload; saying so at boot beats discovering it in the UI.
      expect(result.configured).toBe(false);
      expect(!result.configured && result.reason).toContain('both required');
    },
  );

  it.each([['not-a-url'], ['file:///etc/passwd'], ['ftp://store/bucket']])(
    'refuses a non-http endpoint (%s)',
    (endpoint) => {
      const result = resolveEnvObjectStore({
        ...SELF_HOSTED,
        OBJECT_STORE_ENDPOINT: endpoint,
      });
      expect(result.configured).toBe(false);
    },
  );

  it('refuses a non-http public endpoint', () => {
    const result = resolveEnvObjectStore({
      ...SELF_HOSTED,
      OBJECT_STORE_PUBLIC_ENDPOINT: 'ftp://cdn.example',
    });
    expect(result.configured).toBe(false);
    expect(!result.configured && result.reason).toContain(
      'OBJECT_STORE_PUBLIC_ENDPOINT',
    );
  });

  describe('AWS S3 proper (no endpoint)', () => {
    it('is configured on the credential pair alone', () => {
      // The endpoint is what a SELF-HOSTED store needs; AWS is addressed by
      // bucket + region, so demanding one would lock AWS out of being the
      // deployment default at all.
      const result = resolveEnvObjectStore({
        ...KEYS,
        OBJECT_STORE_BUCKET: 'acme-tale',
        OBJECT_STORE_REGION: 'eu-central-1',
      });
      expect(result.configured).toBe(true);
      if (!result.configured) return;
      expect(result.store.endpoint).toBeUndefined();
      expect(result.store.bucket).toBe('acme-tale');
    });

    it('defaults to virtual-host addressing, which AWS requires', () => {
      const result = resolveEnvObjectStore(KEYS);
      expect(result.configured && result.store.forcePathStyle).toBe(false);
    });
  });

  describe('forcePathStyle', () => {
    it('defaults to path-style when an endpoint is set', () => {
      // A self-hosted store has no per-bucket DNS.
      const result = resolveEnvObjectStore(SELF_HOSTED);
      expect(result.configured && result.store.forcePathStyle).toBe(true);
    });

    it.each([
      ['false', false],
      ['0', false],
      ['off', false],
      ['true', true],
      ['1', true],
      ['YES', true],
    ])('takes an explicit %s over the implied default', (raw, expected) => {
      const result = resolveEnvObjectStore({
        ...SELF_HOSTED,
        OBJECT_STORE_FORCE_PATH_STYLE: raw,
      });
      expect(result.configured && result.store.forcePathStyle).toBe(expected);
    });

    it('refuses an unrecognised spelling rather than guessing', () => {
      // A silent false here would 404 every object, long after boot.
      const result = resolveEnvObjectStore({
        ...SELF_HOSTED,
        OBJECT_STORE_FORCE_PATH_STYLE: 'maybe',
      });
      expect(result.configured).toBe(false);
      expect(!result.configured && result.reason).toContain(
        'OBJECT_STORE_FORCE_PATH_STYLE',
      );
    });
  });

  describe('prefix', () => {
    it('carries an operator-chosen key namespace', () => {
      const result = resolveEnvObjectStore({
        ...SELF_HOSTED,
        OBJECT_STORE_PREFIX: 'tale/prod',
      });
      expect(result.configured && result.store.prefix).toBe('tale/prod');
    });

    it('omits an empty prefix so blobs live at the bucket root', () => {
      const result = resolveEnvObjectStore({
        ...SELF_HOSTED,
        OBJECT_STORE_PREFIX: '   ',
      });
      expect(result.configured && result.store.prefix).toBeUndefined();
    });
  });
});
