import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { visibleApiNavItems } from '@/app/routes/dashboard/$id/settings/api/-nav-items';

import { useApiSettingsAccess } from './use-api-settings-access';

/**
 * Who opens which API settings tab: owners, admins and developers every tab;
 * a member who may call the model endpoints (a `tale:models.api` grant) the
 * REST tab — where their personal key is made — and the Models tab alone;
 * anyone else none.
 */

const state = vi.hoisted(() => ({
  developer: false,
  abilityLoading: false,
  standing: {
    isLoading: false,
    data: undefined as undefined | { allowed: boolean },
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.developer }),
  useAbilityLoading: () => state.abilityLoading,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyModelApiAccess: () => state.standing,
}));

beforeEach(() => {
  state.developer = false;
  state.abilityLoading = false;
  state.standing = { isLoading: false, data: undefined };
});

describe('useApiSettingsAccess', () => {
  it('opens everything to a developer role, without waiting on the grant', () => {
    state.developer = true;
    state.standing = { isLoading: true, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: true,
      modelApi: true,
      loading: false,
    });
  });

  it('opens the model tabs to a member holding the grant', () => {
    state.standing = { isLoading: false, data: { allowed: true } };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: false,
      modelApi: true,
      loading: false,
    });
  });

  it('waits for the grant before deciding for any other member', () => {
    state.standing = { isLoading: true, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.modelApi).toBe(false);
  });
});

describe('visibleApiNavItems', () => {
  const slugs = (access: { developer: boolean; modelApi: boolean }) =>
    visibleApiNavItems(access).map((item) => item.slug);

  it('lists every tab for a developer role, Models beside REST', () => {
    expect(slugs({ developer: true, modelApi: true })).toEqual([
      'rest',
      'models',
      'mcp',
      'webdav',
    ]);
  });

  it('lists REST and Models alone for a member holding the grant', () => {
    expect(slugs({ developer: false, modelApi: true })).toEqual([
      'rest',
      'models',
    ]);
  });

  it('lists nothing for any other member', () => {
    expect(slugs({ developer: false, modelApi: false })).toEqual([]);
  });
});
