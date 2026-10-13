// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  forgetChoice,
  rememberChoice,
  rememberedChoice,
} from './agent-consent-memory';

const request = { codeChallenge: 'challenge-1' };
const choice = {
  organizationId: 'org-acme',
  choice: {
    level: 'deploy' as const,
    extras: new Set(['tale:settings.read', 'tale:settings.write'] as const),
  },
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('what was chosen, kept across the reload a confirmation causes', () => {
  it('comes back as it was left: the organization, the level and the extras', () => {
    rememberChoice(request, choice, 1_000);
    expect(rememberedChoice(request, 2_000)).toEqual(choice);
  });

  it('is kept for the request, not for the app: another request finds nothing', () => {
    rememberChoice(request, choice, 1_000);
    expect(
      rememberedChoice({ codeChallenge: 'challenge-2' }, 2_000),
    ).toBeNull();
  });

  it('runs out after ten minutes', () => {
    rememberChoice(request, choice, 1_000);
    expect(rememberedChoice(request, 1_000 + 10 * 60 * 1000)).not.toBeNull();
    expect(rememberedChoice(request, 1_001 + 10 * 60 * 1000)).toBeNull();
  });

  it('is gone once it is forgotten', () => {
    rememberChoice(request, choice, 1_000);
    forgetChoice(request);
    expect(rememberedChoice(request, 2_000)).toBeNull();
  });

  it('keeps nothing for a request that names no challenge', () => {
    rememberChoice({ codeChallenge: null }, choice, 1_000);
    rememberChoice({ codeChallenge: '' }, choice, 1_000);
    expect(window.sessionStorage.length).toBe(0);
    expect(rememberedChoice({ codeChallenge: null }, 2_000)).toBeNull();
  });

  it('reads only what it understands: unknown extras drop out, an unknown level or a damaged value is nothing', () => {
    window.sessionStorage.setItem(
      'tale:agent-consent:challenge-1',
      JSON.stringify({
        organizationId: 'org-acme',
        level: 'edit',
        extras: ['tale:settings.read', 'tale:root.access'],
        at: 1_000,
      }),
    );
    expect(rememberedChoice(request, 2_000)?.choice.extras).toEqual(
      new Set(['tale:settings.read']),
    );
    for (const value of [
      JSON.stringify({ organizationId: 'a', level: 'root', extras: [], at: 1 }),
      JSON.stringify({ organizationId: 'a', level: 'edit', extras: [] }),
      JSON.stringify({ level: 'edit', extras: [], at: 1 }),
      JSON.stringify([1, 2]),
      '"text"',
      'null',
    ]) {
      window.sessionStorage.setItem('tale:agent-consent:challenge-1', value);
      expect(rememberedChoice(request, 2), value).toBeNull();
    }
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.sessionStorage.setItem('tale:agent-consent:challenge-1', '{nope');
    expect(rememberedChoice(request, 2)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('is nothing, quietly, in a browser that refuses storage', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(() => rememberChoice(request, choice, 1)).not.toThrow();
    expect(rememberedChoice(request, 2)).toBeNull();
    expect(() => forgetChoice(request)).not.toThrow();
  });
});
