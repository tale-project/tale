import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from '@/app/lib/backend/query-keys';
import { PROVIDER_CREDENTIAL_HINT_ENTITY } from '@/lib/shared/hint-entities';

import { CUSTOM_VENDOR_KEY } from '../components/provider-definition-form';
import {
  useCreateProviderCredential,
  useUpdateProviderCredential,
} from './custom-provider-mutations';
import { providerCatalogsQueryKey } from './queries';

/**
 * The custom-provider composition behind the credential dialog. Creating:
 * the definition is written first (the credential needs a slug to name), the
 * credential second, and a refused credential takes the definition back
 * out. Editing: one write of both parts, each against the version the
 * dialog read. The backend actions and the credential hooks are stubbed at
 * their module boundaries; what is under test is the order, the arguments,
 * the rollback and the versions.
 */

const actions = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateWithDefinition: vi.fn(),
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
  useUpdateCredentialWithDefinition: () => ({
    mutateAsync: actions.updateWithDefinition,
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

/** The credential listing the page holds, under the entity a write refreshes. */
const credentialsKey = backendKey(
  'org-1',
  PROVIDER_CREDENTIAL_HINT_ENTITY,
  'list',
);

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  client.setQueryData(credentialsKey, []);
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
  /** The definition the dialog's facts were read from (the listing's hash). */
  const qwen = {
    name: 'qwen-cn',
    displayName: 'Qwen CN',
    apiFormat: 'openai',
    baseUrl: 'https://maas.example.test/v1',
    catalog: { source: 'models-endpoint' },
    auth: [{ method: 'api-key' }],
  };
  const reviewed = { credentialHash: 'c1', definitionHash: 'h1' };
  /** The dialog's Save: a rename, the allowlist cleared, new facts. */
  const edit = {
    organizationId: 'org-1',
    credentialId: 'c9',
    name: 'Qwen China',
    modelAllowlist: null,
    customProvider: {
      providerSlug: 'qwen-cn',
      apiFormat: 'anthropic' as const,
      baseUrl: 'https://maas.example.test/v2',
      catalogSource: 'none' as const,
    },
    reviewed,
  };
  const render = () =>
    renderHook(() => useUpdateProviderCredential(), { wrapper }).result;

  it('saves the credential and the provider in one write, against the versions the dialog read', async () => {
    actions.read.mockResolvedValue({ config: qwen, hash: 'h1' });
    actions.updateWithDefinition.mockResolvedValue(null);
    await render().current.mutateAsync(edit);
    expect(actions.read).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'qwen-cn',
    });
    expect(actions.updateWithDefinition).toHaveBeenCalledWith({
      organizationId: 'org-1',
      credentialId: 'c9',
      name: 'Qwen China',
      endpointUrl: undefined,
      modelAllowlist: null,
      expectedHash: 'c1',
      definition: {
        // Named after the credential; what the form has no field for rides
        // along from the reviewed definition.
        config: {
          name: 'qwen-cn',
          displayName: 'Qwen China',
          apiFormat: 'anthropic',
          baseUrl: 'https://maas.example.test/v2',
          catalog: { source: 'none' },
          auth: [{ method: 'api-key' }],
        },
        expectedHash: 'h1',
      },
    });
    // No part is written on its own.
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.update).not.toHaveBeenCalled();
    expect(
      client.getQueryState(providerCatalogsQueryKey('org-1'))?.isInvalidated,
    ).toBe(true);
  });

  it('writes no provider facts ahead of a credential the server refuses (#3662)', async () => {
    actions.read.mockResolvedValue({ config: qwen, hash: 'h1' });
    const taken = Object.assign(new Error('CREDENTIAL_NAME_TAKEN'), {
      data: {
        code: 'CREDENTIAL_NAME_TAKEN',
        message:
          'A credential named "Qwen B" already exists for this provider — pick a different name.',
      },
    });
    actions.updateWithDefinition.mockRejectedValue(taken);
    await expect(
      render().current.mutateAsync({ ...edit, name: 'Qwen B' }),
    ).rejects.toBe(taken);
    // The refusal is the one write's: the definition was never saved apart
    // from the credential, so there is nothing to leave behind.
    expect(actions.updateWithDefinition).toHaveBeenCalledTimes(1);
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.update).not.toHaveBeenCalled();
  });

  it('refuses a dialog older than the definition instead of saving over it (#3663)', async () => {
    // Someone saved v2 since the dialog read v1 (h1): the current hash is h2.
    actions.read.mockResolvedValue({
      config: { ...qwen, baseUrl: 'https://maas.example.test/v9' },
      hash: 'h2',
    });
    await expect(
      render().current.mutateAsync({
        ...edit,
        // A name-only edit: the facts are the ones the dialog was seeded with.
        customProvider: {
          providerSlug: 'qwen-cn',
          apiFormat: 'openai',
          baseUrl: 'https://maas.example.test/v1',
          catalogSource: 'models-endpoint',
        },
      }),
    ).rejects.toMatchObject({ data: { code: 'CONFIG_VERSION_CONFLICT' } });
    expect(actions.updateWithDefinition).not.toHaveBeenCalled();
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.update).not.toHaveBeenCalled();
    // The listings refetch, so a reopened dialog reads the newer versions.
    expect(
      client.getQueryState(providerCatalogsQueryKey('org-1'))?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(credentialsKey)?.isInvalidated).toBe(true);
  });

  it('refuses an edit whose versions the dialog never had', async () => {
    await expect(
      render().current.mutateAsync({ ...edit, reviewed: undefined }),
    ).rejects.toMatchObject({ data: { code: 'CONFIG_VERSION_CONFLICT' } });
    expect(actions.read).not.toHaveBeenCalled();
    expect(actions.updateWithDefinition).not.toHaveBeenCalled();
  });

  it('passes a plain credential edit straight through and refuses to edit a vanished provider', async () => {
    actions.update.mockResolvedValue(null);
    const result = render();
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
        reviewed,
      }),
    ).rejects.toMatchObject({ data: { code: 'PROVIDER_NOT_FOUND' } });
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.updateWithDefinition).not.toHaveBeenCalled();
  });
});
