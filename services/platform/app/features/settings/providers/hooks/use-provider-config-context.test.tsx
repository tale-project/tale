// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import type { ProviderJson } from '@/lib/shared/schemas/providers';

const mutateAsync = vi.fn().mockResolvedValue({ hash: 'hash-2' });
vi.mock('./mutations', () => ({
  useSaveProvider: () => ({ mutateAsync }),
}));

import {
  ProviderConfigProvider,
  useProviderConfig,
} from './use-provider-config-context';

const BASE = {
  displayName: 'OpenAI',
  baseUrl: 'https://api.openai.com',
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture
} as ProviderJson;

function wrapper(initial: ProviderJson, initialHash?: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ProviderConfigProvider
        organizationId="org_1"
        providerName="openai"
        initialConfig={initial}
        initialHash={initialHash}
      >
        {children}
      </ProviderConfigProvider>
    );
  };
}

afterEach(() => vi.clearAllMocks());

describe('useProviderConfig', () => {
  it('starts clean and dirties on updateConfig', () => {
    const { result } = renderHook(() => useProviderConfig(), {
      wrapper: wrapper(BASE),
    });
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.updateConfig({ displayName: 'Anthropic' }));
    expect(result.current.isDirty).toBe(true);
  });

  it('saveConfig persists, sends expectedHash, and clears dirty (regression: stale baseline)', async () => {
    const { result } = renderHook(() => useProviderConfig(), {
      wrapper: wrapper(BASE, 'hash-1'),
    });

    act(() => result.current.updateConfig({ displayName: 'Anthropic' }));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.saveConfig();
    });

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        providerName: 'openai',
        expectedHash: 'hash-1',
        config: expect.objectContaining({ displayName: 'Anthropic' }),
      }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('saveConfig with a partial merges and clears dirty', async () => {
    const { result } = renderHook(() => useProviderConfig(), {
      wrapper: wrapper(BASE, 'hash-1'),
    });

    await act(async () => {
      await result.current.saveConfig({ baseUrl: 'https://proxy.example' });
    });

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          baseUrl: 'https://proxy.example',
          displayName: 'OpenAI',
        }),
      }),
    );
    expect(result.current.isDirty).toBe(false);
    expect(result.current.config.baseUrl).toBe('https://proxy.example');
  });

  it('markSaving(false) commits the working copy as the baseline', () => {
    const { result } = renderHook(() => useProviderConfig(), {
      wrapper: wrapper(BASE),
    });
    act(() => result.current.updateConfig({ displayName: 'X' }));
    act(() => result.current.markSaving(true));
    act(() => result.current.markSaving(false));
    expect(result.current.isDirty).toBe(false);
  });
});
