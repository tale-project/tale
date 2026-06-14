import { describe, expect, test } from 'bun:test';

import { EnvStore } from './env-store.ts';

describe('EnvStore', () => {
  test('seeds non-denied vars, drops denied seeds', () => {
    const s = new EnvStore({ FOO: '1', HOME: '/evil', HTTPS_PROXY: 'x' });
    const r = s.resolve();
    expect(r.FOO).toBe('1');
    expect(r.HOME).toBeUndefined();
    expect(r.HTTPS_PROXY).toBeUndefined();
  });

  test('patch set/unset; deny-list reported', () => {
    const s = new EnvStore();
    const denied = s.patch(
      { A: '1', PATH: '/evil', TALE_RUNNERD_TOKEN: 'x', http_proxy: 'y' },
      ['B'],
    );
    expect(denied).toContain('PATH');
    expect(denied).toContain('TALE_RUNNERD_TOKEN');
    expect(denied).toContain('http_proxy');
    expect(s.resolve().A).toBe('1');
  });

  test('overlay wins over store, deny-list enforced on overlay', () => {
    const s = new EnvStore({ A: 'base' });
    const r = s.resolve({ A: 'over', TMPDIR: '/evil' });
    expect(r.A).toBe('over');
    expect(r.TMPDIR).toBeUndefined();
  });

  test('unset removes a var', () => {
    const s = new EnvStore({ A: '1' });
    s.patch(undefined, ['A']);
    expect(s.resolve().A).toBeUndefined();
  });
});
