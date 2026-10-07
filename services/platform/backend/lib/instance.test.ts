// @vitest-environment node

import { hostname } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  engineVersion,
  instanceId,
  replicaColour,
  resetInstanceIdForTests,
} from './instance.ts';

/**
 * The identity a run's lease names. Its colour must be the LAST segment, so
 * a drain can count one colour's leases in SQL with
 * `substring(lease_owner from '[^:]*$')`; any `:` inside a segment would
 * move it.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  resetInstanceIdForTests();
});

describe('instanceId', () => {
  it('names host, pid, version and colour, colour last', () => {
    vi.stubEnv('TALE_VERSION', '0.5.80');
    vi.stubEnv('TALE_COLOR', 'green');
    const id = instanceId();
    expect(id).toBe(
      `${hostname().replaceAll(':', '-')}:${process.pid}:0.5.80:green`,
    );
    expect(/[^:]*$/.exec(id)?.[0]).toBe('green');
  });

  it('scrubs a colon inside a segment, so the colour stays last', () => {
    vi.stubEnv('TALE_VERSION', 'sha:abc');
    vi.stubEnv('TALE_COLOR', 'blue');
    const id = instanceId();
    expect(id.split(':')).toHaveLength(4);
    expect(id).toContain(':sha-abc:');
    expect(id.endsWith(':blue')).toBe(true);
  });

  it('reads `dev` and `none` outside a release and a colour', () => {
    vi.stubEnv('TALE_VERSION', '');
    vi.stubEnv('TALE_COLOR', '');
    expect(instanceId().endsWith(':dev:none')).toBe(true);
  });

  it('is computed once per process', () => {
    vi.stubEnv('TALE_COLOR', 'blue');
    const first = instanceId();
    vi.stubEnv('TALE_COLOR', 'green');
    expect(instanceId()).toBe(first);
  });
});

describe('engineVersion and replicaColour', () => {
  it('trim what the image and the colour compose stamped', () => {
    vi.stubEnv('TALE_VERSION', ' 0.5.80 ');
    vi.stubEnv('TALE_COLOR', ' blue ');
    expect(engineVersion()).toBe('0.5.80');
    expect(replicaColour()).toBe('blue');
  });
});
