import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CUSTOM_VENDOR_KEY } from '../components/provider-definition-form';
import {
  useCreateProviderCredential,
  useUpdateProviderCredential,
} from './custom-provider-mutations';
import { providerCatalogsQueryKey } from './queries';

/**
 * The custom-provider composition behind the credential dialog: the
 * definition is written first (the credential needs a slug to name), the
 * credential second, and a refused credential takes the definition back
 * out. The backend actions and the credential hooks are stubbed at their
 * module boundaries; what is under test is the order, the arguments and
 * the rollback.
 */

const actions = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: (name: string) => ({
    mutateAsync: name.endsWith(':saveProviderDefinition')
      ? actions.save
      : name.endsWith(':deleteProviderDefinition')
        ? actions.remove
        : actions.read,
    isPending: false,
  }),
}));

vi.mock('./mutations', () => ({
  useCreateCredential: () => ({
    mutateAsync: actions.create,
    isPending: false,
  }),
  useUpdateCredential: () => ({
    mutateAsync: actions.update,
    isPending: false,
  }),
}));

const facts = {
  providerSlug: CUSTOM_VENDOR_KEY,
  apiFormat: 'openai' as const,
  baseUrl: 'https://maas.example.test/v1',
  catalogSource: 'models-endpoint' as const,
};

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  // The catalog listing the page holds: the shipped set plus one custom
  // provider, so a new slug has to number past both.
  client.setQueryData(providerCatalogsQueryKey('org-1'), [
    { name: 'openai' },
    { name: 'qwen-cn' },
  ]);
});

describe('useCreateProviderCredential', () => {
  it('passes a shipped vendor straight through', async () => {
    actions.create.mockResolvedValue({ credentialId: 'c1' });
    const { result } = renderHook(() => useCreateProviderCredential(), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({
        organizationId: 'org-1',
        providerSlug: 'openai',
        authMethod: 'api-key',
        name: 'Prod',
        secret: 'sk',
      }),
    ).resolves.toEqual({ credentialId: 'c1' });
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'openai',
      authMethod: 'api-key',
      name: 'Prod',
      secret: 'sk',
    });
  });

  it('writes the definition first, slugged past the catalog, then the credential', async () => {
    actions.save.mockResolvedValue({ config: {}, hash: 'h1' });
    actions.create.mockResolvedValue({ credentialId: 'c1' });
    const { result } = renderHook(() => useCreateProviderCredential(), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({
        organizationId: 'org-1',
        providerSlug: CUSTOM_VENDOR_KEY,
        authMethod: 'api-key',
        name: 'Qwen CN',
        secret: 'sk',
        customProvider: facts,
      }),
    ).resolves.toEqual({ credentialId: 'c1' });
    expect(actions.save).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'qwen-cn-2',
      config: {
        name: 'qwen-cn-2',
        displayName: 'Qwen CN',
        apiFormat: 'openai',
        baseUrl: 'https://maas.example.test/v1',
        catalog: { source: 'models-endpoint' },
        auth: [{ method: 'api-key' }, { method: 'env' }],
      },
      expectedHash: null,
    });
    expect(actions.create).toHaveBeenCalledWith({
      organizationId: 'org-1',
      providerSlug: 'qwen-cn-2',
      authMethod: 'api-key',
      name: 'Qwen CN',
      secret: 'sk',
    });
    expect(actions.save.mock.invocationCallOrder[0]).toBeLessThan(
      actions.create.mock.invocationCallOrder[0] ?? 0,
    );
    expect(actions.remove).not.toHaveBeenCalled();
    // The listing the picker and the table read is refetched.
    expect(
      client.getQueryState(providerCatalogsQueryKey('org-1'))?.isInvalidated,
    ).toBe(true);
  });

  it('takes the definition back out when the credential is refused', async () => {
    actions.save.mockResolvedValue({ config: {}, hash: 'h1' });
    actions.create.mockRejectedValue(new Error('CREDENTIAL_NAME_TAKEN'));
    actions.remove.mockResolvedValue(null);
    const { result } = renderHook(() => useCreateProviderCredential(), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({
        organizationId: 'org-1',
        providerSlug: CUSTOM_VENDOR_KEY,
        authMethod: 'api-key',
        name: 'Local vLLM',
        secret: 'sk',
        customProvider: facts,
      }),
    ).rejects.toThrow('CREDENTIAL_NAME_TAKEN');
    expect(actions.remove).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'local-vllm',
    });
  });

  it('refuses a plain-http public endpoint before any request goes out', async () => {
    const { result } = renderHook(() => useCreateProviderCredential(), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({
        organizationId: 'org-1',
        providerSlug: CUSTOM_VENDOR_KEY,
        authMethod: 'api-key',
        name: 'Local',
        secret: 'sk',
        customProvider: { ...facts, baseUrl: 'http://models.example.test/v1' },
      }),
    ).rejects.toMatchObject({ data: { code: 'PROVIDER_DEFINITION_INVALID' } });
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.create).not.toHaveBeenCalled();
  });
});

describe('useUpdateProviderCredential', () => {
  it('saves the provider facts against the loaded hash, named after the credential, before the credential itself', async () => {
    actions.read.mockResolvedValue({
      config: {
        name: 'qwen-cn',
        displayName: 'Qwen CN',
        apiFormat: 'openai',
        baseUrl: 'https://maas.example.test/v1',
        catalog: { source: 'models-endpoint' },
        auth: [{ method: 'api-key' }],
      },
      hash: 'h1',
    });
    actions.save.mockResolvedValue({ config: {}, hash: 'h2' });
    actions.update.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateProviderCredential(), {
      wrapper,
    });
    await result.current.mutateAsync({
      organizationId: 'org-1',
      credentialId: 'c1',
      name: 'Qwen China',
      modelAllowlist: null,
      customProvider: {
        providerSlug: 'qwen-cn',
        apiFormat: 'anthropic',
        baseUrl: 'https://maas.example.test/v2',
        catalogSource: 'none',
      },
    });
    expect(actions.read).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'qwen-cn',
    });
    expect(actions.save).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'qwen-cn',
      config: {
        name: 'qwen-cn',
        displayName: 'Qwen China',
        apiFormat: 'anthropic',
        baseUrl: 'https://maas.example.test/v2',
        catalog: { source: 'none' },
        auth: [{ method: 'api-key' }],
      },
      expectedHash: 'h1',
    });
    expect(actions.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'c1',
      name: 'Qwen China',
      modelAllowlist: null,
    });
    expect(actions.save.mock.invocationCallOrder[0]).toBeLessThan(
      actions.update.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('passes a plain credential edit straight through and refuses to edit a vanished provider', async () => {
    actions.update.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateProviderCredential(), {
      wrapper,
    });
    await result.current.mutateAsync({
      organizationId: 'org-1',
      credentialId: 'c1',
      name: 'Renamed',
    });
    expect(actions.read).not.toHaveBeenCalled();
    expect(actions.update).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'c1',
      name: 'Renamed',
    });

    actions.read.mockResolvedValue({ config: null, hash: null });
    await expect(
      result.current.mutateAsync({
        organizationId: 'org-1',
        credentialId: 'c1',
        customProvider: { ...facts, providerSlug: 'gone' },
      }),
    ).rejects.toMatchObject({ data: { code: 'PROVIDER_NOT_FOUND' } });
    expect(actions.save).not.toHaveBeenCalled();
  });
});
