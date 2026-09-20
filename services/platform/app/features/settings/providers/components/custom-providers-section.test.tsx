import type { ProviderDefinition } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { CustomProvidersSection } from './custom-providers-section';

/**
 * Component coverage for the custom-providers section of the AI-providers
 * settings page: the organization's own definitions as rows, the add/edit
 * dialog's projection into the native document, the delete refusal while
 * credentials name a provider, and the model check. The backend's own rules
 * (the reserved-name and host-policy refusals, the compare-and-set, the
 * history archive) live in `backend/domains/providers/config-routes.test.ts`;
 * the hooks are stubbed at the module boundary.
 */

const saveDefinition = vi.hoisted(() => vi.fn());
const deleteDefinition = vi.hoisted(() => vi.fn());
const checkCatalog = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());
const definitionRead = vi.hoisted(() => ({
  data: undefined as unknown,
  isPending: false,
  isError: false,
}));

vi.mock('../hooks/queries', () => ({
  useProviderDefinition: () => definitionRead,
}));

vi.mock('../hooks/mutations', () => ({
  useSaveProviderDefinition: () => ({
    mutateAsync: saveDefinition,
    isPending: false,
  }),
  useDeleteProviderDefinition: () => ({
    mutateAsync: deleteDefinition,
    isPending: false,
  }),
  useCheckProviderDefinitionCatalog: () => ({
    mutateAsync: checkCatalog,
    isPending: false,
  }),
  // The credential adapter the rows' wire-facts line comes from imports the
  // credential hooks too; none of them is called here.
  useCreateCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetDefaultCredential: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefreshProviderCatalogs: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// FormDialog reads the org id for its error boundary.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

function model(
  id: string,
  provider: string,
): ProviderCatalog['models'][number] {
  return {
    id,
    provider,
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 32_000,
  };
}

const shipped = {
  name: 'openai',
  displayName: 'OpenAI',
  origin: 'shipped',
  apiFormat: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env'],
  models: [model('gpt-5', 'openai')],
} as unknown as ProviderCatalog;

const gateway = {
  name: 'internal-gateway',
  displayName: 'Internal gateway',
  origin: 'organization',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.test/v1',
  catalogSource: 'models-endpoint',
  authMethods: ['api-key', 'env'],
  models: [model('llama-4', 'internal-gateway')],
} as unknown as ProviderCatalog;

const azureLike = {
  name: 'azure-like',
  displayName: 'Azure-like',
  origin: 'organization',
  apiFormat: 'openai',
  endpointMode: 'per-credential',
  catalogSource: 'none',
  authMethods: ['api-key'],
  models: [],
  catalogError: 'listing refused',
} as unknown as ProviderCatalog;

const storedGateway: ProviderDefinition = {
  name: 'internal-gateway',
  displayName: 'Internal gateway',
  apiFormat: 'openai',
  baseUrl: 'https://models.example.test/v1',
  catalog: { source: 'models-endpoint' },
  auth: [
    { method: 'api-key' },
    { method: 'env' },
    {
      method: 'subscription-key',
      constraints: { execution: 'sandbox', harness: 'claude-code' },
    },
  ],
};

const gatewayCredential = {
  id: 'cred-1',
  name: 'Gateway key',
  providerSlug: 'internal-gateway',
  authMethod: 'api-key',
  isDefault: true,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as unknown as MaskedCredential;

function renderSection(
  overrides: Partial<Parameters<typeof CustomProvidersSection>[0]> = {},
) {
  return render(
    <CustomProvidersSection
      organizationId="org-1"
      catalogs={[shipped, gateway, azureLike]}
      credentials={[]}
      isLoading={false}
      isError={false}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

/** Open the row menu of one custom provider and pick an entry. */
async function pickRowAction(
  user: Awaited<ReturnType<typeof render>>['user'],
  provider: string,
  action: string,
) {
  await user.click(
    screen.getByRole('button', { name: `Actions for ${provider}` }),
  );
  await user.click(
    within(await screen.findByRole('menu')).getByRole('menuitem', {
      name: action,
    }),
  );
}

describe('CustomProvidersSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    definitionRead.data = undefined;
    definitionRead.isPending = false;
    definitionRead.isError = false;
  });

  it("lists only the organization's own definitions, with their slug and wire facts", async () => {
    const { container } = renderSection();
    expect(screen.getByText('Internal gateway')).toBeInTheDocument();
    expect(screen.getByText('internal-gateway')).toBeInTheDocument();
    expect(screen.getByText(/models\.example\.test/)).toBeInTheDocument();
    expect(screen.getByText('Azure-like')).toBeInTheDocument();
    // A failed listing rides the row, as it does on a credential row.
    expect(screen.getByText(/listing refused/)).toBeInTheDocument();
    // The shipped vendor is not the organization's to edit.
    expect(screen.queryByText('OpenAI')).not.toBeInTheDocument();
    await checkAccessibility(container);
  });

  it('offers the one create affordance from the empty state', () => {
    renderSection({ catalogs: [shipped] });
    expect(
      screen.getByRole('heading', { name: 'No custom providers yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Add provider' }),
    ).toHaveLength(1);
  });

  it('suggests the identifier from the display name and writes the native document', async () => {
    saveDefinition.mockResolvedValue({ config: null, hash: 'h1' });
    const { user } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Add custom provider' }),
    );
    await user.type(
      dialog.getByRole('textbox', { name: /^Display name/ }),
      'Internal vLLM',
    );
    const identifier = dialog.getByRole('textbox', { name: /^Identifier/ });
    expect(identifier).toHaveValue('internal-vllm');
    await user.type(
      dialog.getByRole('textbox', { name: /^Base URL/ }),
      'https://vllm.example.test/v1',
    );
    await user.click(dialog.getByRole('button', { name: 'Add provider' }));
    await waitFor(() =>
      expect(saveDefinition).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'internal-vllm',
        config: {
          name: 'internal-vllm',
          displayName: 'Internal vLLM',
          apiFormat: 'openai',
          baseUrl: 'https://vllm.example.test/v1',
          catalog: { source: 'models-endpoint' },
          auth: [{ method: 'api-key' }, { method: 'env' }],
        },
        expectedHash: null,
      }),
    );
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Provider added — now add a credential for it',
    });
  });

  it('refuses an identifier a shipped or existing provider already carries, before any request', async () => {
    const { user } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Add provider' }));
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Add custom provider' }),
    );
    await user.type(
      dialog.getByRole('textbox', { name: /^Display name/ }),
      'OpenAI',
    );
    expect(dialog.getByRole('textbox', { name: /^Identifier/ })).toHaveValue(
      'openai',
    );
    expect(
      await dialog.findByText(
        'This identifier is already taken by another provider.',
      ),
    ).toBeInTheDocument();
    await user.type(
      dialog.getByRole('textbox', { name: /^Base URL/ }),
      'https://vllm.example.test/v1',
    );
    expect(dialog.getByRole('button', { name: 'Add provider' })).toBeDisabled();
    // Once the reader types their own identifier, the display name stops
    // suggesting one.
    const identifier = dialog.getByRole('textbox', { name: /^Identifier/ });
    await user.clear(identifier);
    await user.type(identifier, 'openai-mirror');
    await user.type(
      dialog.getByRole('textbox', { name: /^Display name/ }),
      ' EU',
    );
    expect(identifier).toHaveValue('openai-mirror');
    expect(saveDefinition).not.toHaveBeenCalled();
  });

  it('edits against the loaded hash, keeping the facts the form has no field for', async () => {
    definitionRead.data = { config: storedGateway, hash: 'h1' };
    saveDefinition.mockResolvedValue({ config: storedGateway, hash: 'h2' });
    const { user } = renderSection();
    await pickRowAction(user, 'Internal gateway', 'Edit provider');
    const dialog = within(
      await screen.findByRole('dialog', { name: 'Edit custom provider' }),
    );
    const displayName = dialog.getByRole('textbox', { name: /^Display name/ });
    await waitFor(() => expect(displayName).toHaveValue('Internal gateway'));
    expect(dialog.getByRole('textbox', { name: /^Identifier/ })).toBeDisabled();
    await user.clear(displayName);
    await user.type(displayName, 'Renamed gateway');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(saveDefinition).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'internal-gateway',
        config: { ...storedGateway, displayName: 'Renamed gateway' },
        expectedHash: 'h1',
      }),
    );
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Provider updated' });
  });

  it('refuses to delete a provider while credentials still name it', async () => {
    const { user } = renderSection({ credentials: [gatewayCredential] });
    await pickRowAction(user, 'Internal gateway', 'Delete provider');
    const confirm = within(
      await screen.findByRole('dialog', { name: 'Delete provider' }),
    );
    expect(
      confirm.getByText(
        '1 credential still uses this provider. Delete it first.',
      ),
    ).toBeInTheDocument();
    expect(confirm.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(deleteDefinition).not.toHaveBeenCalled();
  });

  it('deletes an unused provider after an explicit confirm', async () => {
    deleteDefinition.mockResolvedValue(null);
    const { user } = renderSection();
    await pickRowAction(user, 'Internal gateway', 'Delete provider');
    const confirm = within(
      await screen.findByRole('dialog', { name: 'Delete provider' }),
    );
    await user.click(confirm.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteDefinition).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'internal-gateway',
      }),
    );
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Provider deleted' });
  });

  it('checks the live model listing and reports the count, and hides the check where there is no listing', async () => {
    checkCatalog.mockResolvedValue([
      model('llama-4', 'internal-gateway'),
      model('qwen-3', 'internal-gateway'),
    ]);
    const { user } = renderSection();
    await pickRowAction(user, 'Internal gateway', 'Check models');
    await waitFor(() =>
      expect(checkCatalog).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'internal-gateway',
      }),
    );
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'Internal gateway: 2 models listed',
    });
    await user.keyboard('{Escape}');
    await user.click(
      screen.getByRole('button', { name: 'Actions for Azure-like' }),
    );
    expect(
      within(await screen.findByRole('menu')).queryByRole('menuitem', {
        name: 'Check models',
      }),
    ).not.toBeInTheDocument();
  });
});
