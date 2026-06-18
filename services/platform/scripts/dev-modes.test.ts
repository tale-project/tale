import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONVEX_HOST,
  DEFAULT_CONVEX_PORT,
  isTruthy,
  resolveConvexProbeTarget,
} from './dev-modes';

const env = (o: Record<string, string | undefined>): NodeJS.ProcessEnv => o;

describe('isTruthy', () => {
  it('accepts 1/true/yes/on in any case', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'Yes', 'on', 'ON']) {
      expect(isTruthy(v)).toBe(true);
    }
  });
  it('rejects everything else (incl. undefined/empty)', () => {
    for (const v of ['0', 'false', 'no', 'off', '', undefined]) {
      expect(isTruthy(v)).toBe(false);
    }
  });
});

describe('resolveConvexProbeTarget', () => {
  it('defaults to the local backend when CONVEX_URL is unset', () => {
    expect(resolveConvexProbeTarget(env({}))).toEqual({
      host: DEFAULT_CONVEX_HOST,
      port: DEFAULT_CONVEX_PORT,
      url: `http://${DEFAULT_CONVEX_HOST}:${DEFAULT_CONVEX_PORT}`,
    });
  });

  it('parses an explicit CONVEX_URL host/port', () => {
    const t = resolveConvexProbeTarget(
      env({ CONVEX_URL: 'http://1.2.3.4:9999/' }),
    );
    expect(t.host).toBe('1.2.3.4');
    expect(t.port).toBe(9999);
    expect(t.url).toBe('http://1.2.3.4:9999/');
  });

  it('defaults https to 443 when no port is given', () => {
    expect(
      resolveConvexProbeTarget(env({ CONVEX_URL: 'https://convex.example' }))
        .port,
    ).toBe(443);
  });

  it('warns and falls back on a malformed URL', () => {
    const warnings: string[] = [];
    const t = resolveConvexProbeTarget(env({ CONVEX_URL: 'not a url' }), (m) =>
      warnings.push(m),
    );
    expect(t.host).toBe(DEFAULT_CONVEX_HOST);
    expect(warnings.join('')).toContain('not a valid URL');
  });
});
