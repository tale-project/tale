import { describe, expect, it } from 'vitest';

import { matchesScope, scopeOf, sessionIdOfScope } from './scope';

const everySession = { session: null };
const ofSession = (id: number) => ({
  session: { id, name: String(id), status: 'stopped' as const },
});

describe('scopeOf', () => {
  it('is global for a secret for every session', () => {
    expect(scopeOf(everySession)).toBe('global');
  });

  it("is the id of the session a secret is for, as text (a select's value)", () => {
    expect(scopeOf(ofSession(12))).toBe('12');
  });
});

describe('matchesScope', () => {
  it('shows every secret under all', () => {
    expect(matchesScope(everySession, 'all')).toBe(true);
    expect(matchesScope(ofSession(3), 'all')).toBe(true);
  });

  it('shows only the secrets for every session under global', () => {
    expect(matchesScope(everySession, 'global')).toBe(true);
    expect(matchesScope(ofSession(3), 'global')).toBe(false);
  });

  it("shows only a session's own secrets under its id, not those for every session", () => {
    expect(matchesScope(ofSession(3), '3')).toBe(true);
    expect(matchesScope(ofSession(4), '3')).toBe(false);
    expect(matchesScope(everySession, '3')).toBe(false);
  });
});

describe('sessionIdOfScope', () => {
  it('is null for every session, and for the list filter that names none', () => {
    expect(sessionIdOfScope('global')).toBeNull();
    expect(sessionIdOfScope('all')).toBeNull();
  });

  it('is the id of a session', () => {
    expect(sessionIdOfScope('12')).toBe(12);
  });

  it('is null for text that is no id', () => {
    expect(sessionIdOfScope('')).toBeNull();
    expect(sessionIdOfScope('abc')).toBeNull();
    expect(sessionIdOfScope('0')).toBeNull();
    expect(sessionIdOfScope('-4')).toBeNull();
    expect(sessionIdOfScope('1.5')).toBeNull();
  });
});
