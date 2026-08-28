import { describe, expect, it } from 'vitest';

import { loadEnv } from './env.ts';

describe('loadEnv', () => {
  it('applies defaults for port, role, and concurrency', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://x' });
    expect(env.PORT).toBe(3005);
    expect(env.ROLE).toBe('all');
    expect(env.WORKER_CONCURRENCY).toBe(5);
  });

  it('coerces numeric strings', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      PORT: '3999',
      ROLE: 'worker',
      WORKER_CONCURRENCY: '2',
    });
    expect(env.PORT).toBe(3999);
    expect(env.ROLE).toBe('worker');
    expect(env.WORKER_CONCURRENCY).toBe(2);
  });

  it('rejects a missing DATABASE_URL and an unknown role', () => {
    expect(() => loadEnv({})).toThrow();
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://x', ROLE: 'ui' }),
    ).toThrow();
  });
});
