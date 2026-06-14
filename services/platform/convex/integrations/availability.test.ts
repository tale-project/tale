import { describe, it, expect } from 'vitest';

import {
  buildConnectUrl,
  computeAvailability,
  isUsable,
  type ComputeAvailabilityInput,
} from './availability';

const ORG = 'org_123';

function base(
  overrides: Partial<ComputeAvailabilityInput> = {},
): ComputeAvailabilityInput {
  return {
    slug: 'tavily',
    organizationId: ORG,
    title: 'Tavily',
    exists: true,
    boundToAgent: true,
    credential: { isActive: true, status: 'active' },
    ...overrides,
  };
}

describe('buildConnectUrl', () => {
  it('mirrors the client integrations deep-link (tab=all&slug=...)', () => {
    expect(buildConnectUrl(ORG, 'tavily')).toBe(
      `/dashboard/${ORG}/settings/integrations?tab=all&slug=tavily`,
    );
  });
});

describe('computeAvailability', () => {
  it('is usable when bound and credential is active', () => {
    const a = computeAvailability(base());
    expect(a.blockers).toEqual([]);
    expect(isUsable(a)).toBe(true);
    expect(a.boundToAgent).toBe(true);
    expect(a.credentialActive).toBe(true);
  });

  it('reports only not_bound when unbound but credential is active', () => {
    const a = computeAvailability(base({ boundToAgent: false }));
    expect(a.blockers.map((b) => b.reason)).toEqual(['not_bound']);
    expect(isUsable(a)).toBe(false);
    // not_bound is fixed in agent settings, not via the connect link.
    expect(a.blockers[0]?.connectUrl).toBeUndefined();
  });

  it('reports only not_configured when bound but no credential row exists', () => {
    const a = computeAvailability(base({ credential: null }));
    expect(a.blockers.map((b) => b.reason)).toEqual(['not_configured']);
    expect(a.credentialActive).toBe(false);
    expect(a.blockers[0]?.connectUrl).toBe(buildConnectUrl(ORG, 'tavily'));
  });

  it('reports credential_invalid (not not_configured) when a row exists but is not active', () => {
    for (const status of ['error', 'inactive', 'testing'] as const) {
      const a = computeAvailability(
        base({ credential: { isActive: false, status } }),
      );
      expect(a.blockers.map((b) => b.reason)).toEqual(['credential_invalid']);
      expect(a.blockers[0]?.guidance).toContain(status);
    }
    // isActive:false even with status 'active' is not usable.
    const mixed = computeAvailability(
      base({ credential: { isActive: false, status: 'active' } }),
    );
    expect(mixed.credentialActive).toBe(false);
    expect(mixed.blockers.map((b) => b.reason)).toEqual(['credential_invalid']);
  });

  it('reports BOTH not_bound and not_configured when both conditions fail (co-occurrence)', () => {
    const a = computeAvailability(
      base({ boundToAgent: false, credential: null }),
    );
    expect(a.blockers.map((b) => b.reason)).toEqual([
      'not_bound',
      'not_configured',
    ]);
    expect(isUsable(a)).toBe(false);
  });

  it('reports both not_bound and credential_invalid when unbound + inactive credential', () => {
    const a = computeAvailability(
      base({
        boundToAgent: false,
        credential: { isActive: false, status: 'error' },
      }),
    );
    expect(a.blockers.map((b) => b.reason)).toEqual([
      'not_bound',
      'credential_invalid',
    ]);
  });

  it('reports only unknown when the integration does not exist, ignoring other state', () => {
    const a = computeAvailability(
      base({ exists: false, boundToAgent: false, credential: null }),
    );
    expect(a.blockers.map((b) => b.reason)).toEqual(['unknown']);
  });

  it('falls back to slug for the title when none is provided', () => {
    const a = computeAvailability(
      base({ title: undefined, boundToAgent: false }),
    );
    expect(a.title).toBe('tavily');
  });
});
