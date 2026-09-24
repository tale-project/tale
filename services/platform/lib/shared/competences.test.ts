import { describe, expect, it } from 'vitest';

import {
  competenceRecordStatus,
  isPlatformCapability,
  isReservedCompetenceSlug,
  PLATFORM_CAPABILITIES,
} from './competences';

const NOW = 1_790_000_000_000;

describe('competence record status', () => {
  it('reads a live record without an expiry as active', () => {
    expect(
      competenceRecordStatus({ expiresAt: null, revokedAt: null }, NOW),
    ).toBe('active');
  });

  it('reads a record whose expiry has come as expired, to the millisecond', () => {
    expect(
      competenceRecordStatus({ expiresAt: NOW + 1, revokedAt: null }, NOW),
    ).toBe('active');
    expect(
      competenceRecordStatus({ expiresAt: NOW, revokedAt: null }, NOW),
    ).toBe('expired');
  });

  it('lets a revocation outrank an expiry', () => {
    expect(
      competenceRecordStatus({ expiresAt: NOW - 10, revokedAt: NOW - 5 }, NOW),
    ).toBe('revoked');
  });
});

describe('platform capability slugs', () => {
  it('recognises exactly the closed set', () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      expect(isPlatformCapability(capability)).toBe(true);
    }
    expect(isPlatformCapability('tale:rest.act-as ')).toBe(false);
    expect(isPlatformCapability('TALE:rest.act-as')).toBe(false);
    expect(isPlatformCapability('tax-reviewer')).toBe(false);
  });

  it('reserves the namespace whatever the case or padding', () => {
    expect(isReservedCompetenceSlug('tale:anything')).toBe(true);
    expect(isReservedCompetenceSlug('  TALE:Anything')).toBe(true);
    expect(isReservedCompetenceSlug('tax-reviewer')).toBe(false);
    expect(isReservedCompetenceSlug('my-tale:thing')).toBe(false);
  });
});
