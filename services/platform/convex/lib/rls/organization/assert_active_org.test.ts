import { describe, expect, it } from 'vitest';

import { OrganizationMismatchError } from '../errors';
import { assertActiveOrg, isActiveOrg } from './assert_active_org';

describe('isActiveOrg', () => {
  it('is true only when the entity org matches the active org', () => {
    expect(isActiveOrg('org_a', 'org_a')).toBe(true);
    expect(isActiveOrg('org_a', 'org_b')).toBe(false);
  });

  it('treats an org-less entity as belonging to no active org', () => {
    expect(isActiveOrg(undefined, 'org_a')).toBe(false);
  });
});

describe('assertActiveOrg', () => {
  it('passes silently on a match', () => {
    expect(() => assertActiveOrg('org_a', 'org_a')).not.toThrow();
  });

  it('throws OrganizationMismatchError on a mismatch', () => {
    expect(() => assertActiveOrg('org_a', 'org_b')).toThrow(
      OrganizationMismatchError,
    );
    expect(() => assertActiveOrg(undefined, 'org_a')).toThrow(
      OrganizationMismatchError,
    );
  });
});
