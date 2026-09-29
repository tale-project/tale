import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { visibleApiNavItems } from '@/app/routes/dashboard/$id/settings/api/-nav-items';

import { useApiSettingsAccess } from './use-api-settings-access';

/**
 * Who opens which API settings tab: owners, admins and developers every tab;
 * a member who may create a personal API key (a competence that is used with
 * one) the REST tab, where the key is made; one who may call the model
 * endpoints (a `tale:models.api` grant) the Models tab as well; anyone else
 * none.
 */

const state = vi.hoisted(() => ({
  developer: false,
  abilityLoading: false,
  standing: {
    isLoading: false,
    data: undefined as undefined | { allowed: boolean },
  },
  keys: {
    isLoading: false,
    data: undefined as undefined | { mayCreate: boolean; holdsKeys: boolean },
  },
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => state.developer }),
  useAbilityLoading: () => state.abilityLoading,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useMyModelApiAccess: () => state.standing,
  useMyApiKeyAccess: () => state.keys,
}));

beforeEach(() => {
  state.developer = false;
  state.abilityLoading = false;
  state.standing = { isLoading: false, data: undefined };
  state.keys = { isLoading: false, data: undefined };
});

describe('useApiSettingsAccess', () => {
  it('opens everything to a developer role, without waiting on the grants', () => {
    state.developer = true;
    state.standing = { isLoading: true, data: undefined };
    state.keys = { isLoading: true, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: true,
      apiKeys: true,
      createApiKeys: true,
      modelApi: true,
      loading: false,
    });
  });

  it('opens the model tabs to a member holding the grant', () => {
    state.standing = { isLoading: false, data: { allowed: true } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: true, holdsKeys: false },
    };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: false,
      apiKeys: true,
      createApiKeys: true,
      modelApi: true,
      loading: false,
    });
  });

  it('opens the key tab alone to a member who may create a key for another door', () => {
    state.standing = { isLoading: false, data: { allowed: false } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: true, holdsKeys: false },
    };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: false,
      apiKeys: true,
      createApiKeys: true,
      modelApi: false,
      loading: false,
    });
  });

  it('keeps the key tab, without Create, for a member who holds a key after the right lapsed', () => {
    state.standing = { isLoading: false, data: { allowed: false } };
    state.keys = {
      isLoading: false,
      data: { mayCreate: false, holdsKeys: true },
    };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current).toEqual({
      developer: false,
      apiKeys: true,
      createApiKeys: false,
      modelApi: false,
      loading: false,
    });
  });

  it.each([
    ['the model grant', { standing: true, keys: false }],
    ['the key rule', { standing: false, keys: true }],
  ])('waits for %s before deciding for any other member', (_what, loading) => {
    state.standing = { isLoading: loading.standing, data: undefined };
    state.keys = { isLoading: loading.keys, data: undefined };
    const { result } = renderHook(() => useApiSettingsAccess('org-1'));
    expect(result.current.loading).toBe(true);
    expect(result.current.apiKeys).toBe(false);
    expect(result.current.modelApi).toBe(false);
  });
});

describe('visibleApiNavItems', () => {
  const slugs = (access: {
    developer: boolean;
    apiKeys: boolean;
    modelApi: boolean;
  }) => visibleApiNavItems(access).map((item) => item.slug);

  it('lists every tab for a developer role, Models beside REST', () => {
    expect(slugs({ developer: true, apiKeys: true, modelApi: true })).toEqual([
      'rest',
      'models',
      'mcp',
      'webdav',
    ]);
  });

  it('lists REST and Models alone for a member holding the model grant', () => {
    expect(slugs({ developer: false, apiKeys: true, modelApi: true })).toEqual([
      'rest',
      'models',
    ]);
  });

  it('lists REST alone for a member who may create a key for another door', () => {
    expect(slugs({ developer: false, apiKeys: true, modelApi: false })).toEqual(
      ['rest'],
    );
  });

  it('lists nothing for any other member', () => {
    expect(
      slugs({ developer: false, apiKeys: false, modelApi: false }),
    ).toEqual([]);
  });
});
