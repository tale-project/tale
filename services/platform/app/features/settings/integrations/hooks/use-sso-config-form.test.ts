import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

// Stable references: returning a fresh `t`/mutate object per render would make
// the hook's effect deps change every render and spin a render loop.
const h = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  testMock: vi.fn(),
  testExistingMock: vi.fn(),
  removeMock: vi.fn(),
  getFullConfigMock: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('./actions', () => ({
  useUpsertSsoProvider: () => ({ mutateAsync: h.upsertMock, isPending: false }),
  useRemoveSsoProvider: () => ({ mutateAsync: h.removeMock, isPending: false }),
  useSsoFullConfig: () => ({
    mutateAsync: h.getFullConfigMock,
    isPending: false,
  }),
  useTestSsoConfig: () => ({ mutateAsync: h.testMock, isPending: false }),
  useTestExistingSsoConfig: () => ({
    mutateAsync: h.testExistingMock,
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/i18n/client', () => ({ useT: () => ({ t: h.t }) }));

import { useSsoConfigForm } from './use-sso-config-form';

function setup() {
  const onOpenChange = vi.fn();
  const { result } = renderHook(() =>
    useSsoConfigForm({
      open: true,
      onOpenChange,
      organizationId: 'org-1',
      existingProvider: null,
    }),
  );
  return { result, onOpenChange };
}

function fillCredentials(result: ReturnType<typeof setup>['result']) {
  act(() => {
    result.current.setIssuer('https://idp.example.com');
    result.current.setClientId('client-123');
    result.current.setClientSecret('secret-xyz');
  });
}

describe('useSsoConfigForm provider type (#1506)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to entra-id and saves Microsoft Graph scopes + Entra features', async () => {
    h.upsertMock.mockResolvedValueOnce('provider-1');
    const { result } = setup();

    expect(result.current.providerType).toBe('entra-id');
    fillCredentials(result);
    await act(async () => {
      await result.current.handleSave();
    });

    expect(h.upsertMock).toHaveBeenCalledTimes(1);
    const arg = h.upsertMock.mock.calls[0][0];
    expect(arg.providerId).toBe('entra-id');
    expect(arg.scopes).toContain(
      'https://graph.microsoft.com/GroupMember.Read.All',
    );
    expect(arg.providerFeatures?.entraId).toBeDefined();
  });

  it('saves generic OIDC with standard scopes and no provider features', async () => {
    h.upsertMock.mockResolvedValueOnce('provider-2');
    const { result } = setup();

    act(() => result.current.setProviderType('generic-oidc'));
    fillCredentials(result);
    await act(async () => {
      await result.current.handleSave();
    });

    const arg = h.upsertMock.mock.calls[0][0];
    expect(arg.providerId).toBe('generic-oidc');
    expect(arg.scopes).toEqual(['openid', 'email', 'profile']);
    // OneDrive / Graph team-sync are Entra-only; generic persists no features.
    expect(arg.providerFeatures).toBeUndefined();
  });

  it('tests a generic OIDC config against the generic adapter', async () => {
    h.testMock.mockResolvedValueOnce({ valid: true });
    const { result } = setup();

    act(() => result.current.setProviderType('generic-oidc'));
    fillCredentials(result);
    await act(async () => {
      await result.current.handleTest();
    });

    const arg = h.testMock.mock.calls[0][0];
    expect(arg.providerId).toBe('generic-oidc');
    expect(arg.scopes).toEqual(['openid', 'email', 'profile']);
  });

  it('derives generic-oidc provider type from a loaded config', async () => {
    const existingProvider: SsoProvider = {
      _id: 'sso-1',
      providerId: 'generic-oidc',
      issuer: 'https://idp.example.com',
      scopes: ['openid', 'email', 'profile'],
      autoProvisionRole: true,
      roleMappingRules: [],
      defaultRole: 'member',
    };
    h.getFullConfigMock.mockResolvedValueOnce({
      _id: 'sso-1',
      organizationId: 'org-1',
      providerId: 'generic-oidc',
      issuer: 'https://idp.example.com',
      clientId: 'client-123',
      scopes: ['openid', 'email', 'profile'],
      autoProvisionRole: true,
      roleMappingRules: [],
      defaultRole: 'member',
      createdAt: 0,
      updatedAt: 0,
    });

    const { result } = renderHook(() =>
      useSsoConfigForm({
        open: true,
        onOpenChange: vi.fn(),
        organizationId: 'org-1',
        existingProvider,
      }),
    );

    await waitFor(() =>
      expect(result.current.providerType).toBe('generic-oidc'),
    );
    expect(result.current.issuer).toBe('https://idp.example.com');
  });
});
