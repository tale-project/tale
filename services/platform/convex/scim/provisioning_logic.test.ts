import { describe, expect, it } from 'vitest';

import {
  classifyUserOwnership,
  composeDesiredMembers,
  planActivation,
} from './internal_mutations';

/**
 * Pure tests for the activation/deactivation policy that backs SCIM
 * `active:false`, DELETE (soft), and reactivation. No backend required.
 */
describe('planActivation', () => {
  it('creates a new active member at the default role', () => {
    const plan = planActivation(true, undefined, 'member', undefined);
    expect(plan).toEqual({ role: 'member', restoreRole: 'member' });
  });

  it('creates a new inactive member as disabled, remembering the default', () => {
    const plan = planActivation(false, undefined, 'developer', undefined);
    expect(plan).toEqual({ role: 'disabled', restoreRole: 'developer' });
  });

  it('keeps an already-active member at its current (admin-set) role', () => {
    const plan = planActivation(true, 'admin', 'member', undefined);
    expect(plan).toEqual({ role: 'admin', restoreRole: 'admin' });
  });

  it('deactivating stores the prior role as the restore point', () => {
    const plan = planActivation(false, 'admin', 'member', undefined);
    expect(plan).toEqual({ role: 'disabled', restoreRole: 'admin' });
  });

  it('reactivating restores the last active role over the default', () => {
    const plan = planActivation(true, 'disabled', 'member', 'developer');
    expect(plan).toEqual({ role: 'developer', restoreRole: 'developer' });
  });

  it('reactivating with no remembered role falls back to the default', () => {
    const plan = planActivation(true, 'disabled', 'member', undefined);
    expect(plan).toEqual({ role: 'member', restoreRole: 'member' });
  });

  it('deactivating an already-disabled member preserves the remembered role', () => {
    const plan = planActivation(false, 'disabled', 'member', 'editor');
    expect(plan).toEqual({ role: 'disabled', restoreRole: 'editor' });
  });

  it('is case-insensitive on the current role', () => {
    expect(planActivation(true, 'ADMIN', 'member', undefined).role).toBe(
      'admin',
    );
  });
});

/**
 * The org-ownership gate that stops a SCIM token in one tenant from grafting
 * onto / renaming a user account owned by another tenant (#2036).
 */
describe('classifyUserOwnership', () => {
  it('reuses a user already a member of the token org', () => {
    expect(classifyUserOwnership([{ organizationId: 'orgA' }], 'orgA')).toBe(
      'owned-here',
    );
  });

  it('rejects a user owned only by another org (cross-tenant)', () => {
    expect(classifyUserOwnership([{ organizationId: 'orgB' }], 'orgA')).toBe(
      'owned-elsewhere',
    );
  });

  it('treats a membership-less global user as unowned (attachable)', () => {
    expect(classifyUserOwnership([], 'orgA')).toBe('unowned');
  });

  it('prefers ownership-here when the user is in both orgs', () => {
    expect(
      classifyUserOwnership(
        [{ organizationId: 'orgB' }, { organizationId: 'orgA' }],
        'orgA',
      ),
    ).toBe('owned-here');
  });
});

/**
 * SCIM Group PATCH membership composition — a clear-all/replace must still apply
 * the adds in the same PATCH (#2085[13]).
 */
describe('composeDesiredMembers', () => {
  it('keeps adds when combined with a value-less remove (replace=[])', () => {
    expect(composeDesiredMembers([], ['a', 'b'], [])).toEqual(['a', 'b']);
  });

  it('composes a replace base with adds and removes', () => {
    expect(composeDesiredMembers(['a', 'b'], ['c'], ['a'])).toEqual(['b', 'c']);
  });

  it('clears all members for a bare value-less remove', () => {
    expect(composeDesiredMembers([], [], [])).toEqual([]);
  });

  it('dedupes an id present in both replace and add', () => {
    expect(composeDesiredMembers(['a'], ['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
