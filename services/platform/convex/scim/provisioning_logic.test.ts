import { describe, expect, it } from 'vitest';

import { planActivation } from './internal_mutations';

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
