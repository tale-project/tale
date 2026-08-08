import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SettingsHeaderActionsSetter,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
import { checkAccessibility } from '@/tests/utils/a11y';
import { pickFilterOption } from '@/tests/utils/filters';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import type { ProviderCatalog, MaskedCredential } from '../hooks/queries';
import { ProvidersSettings } from './providers-settings';

/**
 * Component coverage for the AI-providers settings page.
 *
 * The page is a TABLE of the organization's credentials over the shipped
 * catalog: rows carry the key, the provider it authenticates, and its wire
 * facts; the catalog itself lives behind "Add credential", where picking a
 * provider is step one. Backend behaviour (encryption, method validation,
 * default swaps) stays with the convex tests — the hooks are stubbed at the
 * module boundary.
 */

const createCredential = vi.hoisted(() => vi.fn());
const updateCredential = vi.hoisted(() => vi.fn());
const deleteCredential = vi.hoisted(() => vi.fn());
const setDefaultCredential = vi.hoisted(() => vi.fn());
const refreshCatalogs = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => ({
  catalogs: [] as unknown[],
  credentials: [] as unknown[],
  catalogsError: null as unknown,
}));

vi.mock('../hooks/queries', () => ({
  providerCatalogsQueryKey: (organizationId: string) => [
    'providers',
    'catalogs',
    organizationId,
  ],
  harnessStatusQueryKey: (organizationId: string) => [
    'providers',
    'harness-status',
    organizationId,
  ],
  useProviderCatalogs: () => ({
    data: fixtures.catalogs,
    isPending: false,
    isError: fixtures.catalogsError !== null,
    error: fixtures.catalogsError,
  }),
  useProviderCredentials: () => ({
    data: fixtures.credentials,
    isPending: false,
    isError: false,
    error: null,
  }),
  // The harness status section carries its own component test; the page test
  // only needs it to render quietly.
  useHarnessStatus: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
  useHarnessHealth: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateCredential: () => ({
    mutateAsync: createCredential,
    isPending: false,
  }),
  useUpdateCredential: () => ({
    mutateAsync: updateCredential,
    isPending: false,
  }),
  useDeleteCredential: () => ({
    mutateAsync: deleteCredential,
    isPending: false,
  }),
  useSetDefaultCredential: () => ({
    mutateAsync: setDefaultCredential,
    isPending: false,
  }),
  useRefreshProviderCatalogs: () => ({
    mutateAsync: refreshCatalogs,
    isPending: false,
  }),
}));

// The `?provider=` seed lives in the URL. Backed by component state here so the
// page's behaviour is testable without a router; the real round trip is
// verified in the browser.
vi.mock('@/app/hooks/use-url-state', () => {
  const React = require('react') as typeof import('react');
  return {
    useUrlState: () => {
      const [provider, setProvider] = React.useState<string | null>(null);
      return {
        state: { provider },
        setState: (_key: string, value: string | null) => setProvider(value),
        setStates: () => {},
        clearState: () => {},
        clearAll: () => {},
        isPending: false,
      };
    },
  };
});

// Developer by default; one test flips the capability off to assert the gate.
const abilityState = vi.hoisted(() => ({ canRead: true }));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => abilityState.canRead,
    cannot: () => !abilityState.canRead,
  }),
  useAbilityLoading: () => false,
}));

// FormDialog reads the org id for its error boundary.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: toastSpy,
  useToast: () => ({ toast: toastSpy }),
}));

/**
 * The settings header slot, stood up around the page.
 *
 * "Refresh catalogs" is a page action, so it registers into the settings
 * shell's header rather than the table's own toolbar. Without the shell there
 * is nothing for it to register INTO, and the button silently never renders —
 * so the test provides the same slot the route does.
 */
function WithHeaderSlot({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<SettingsHeaderAction[]>([]);
  return (
    <SettingsHeaderActionsSetter.Provider value={setActions}>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.loading
            ? (action.loadingLabel ?? action.label)
            : action.label}
        </button>
      ))}
      {children}
    </SettingsHeaderActionsSetter.Provider>
  );
}

const renderPage = () =>
  render(
    <WithHeaderSlot>
      <ProvidersSettings organizationId="org-1" />
    </WithHeaderSlot>,
  );

function model(id: string): ProviderCatalog['models'][number] {
  return {
    id,
    provider: 'anthropic',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 200_000,
  };
}

const anthropicProvider = {
  name: 'anthropic',
  displayName: 'Anthropic',
  apiFormat: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1',
  catalogSource: 'static',
  authMethods: ['api-key', 'env', 'subscription-broker'],
  models: [model('claude-fable-5'), model('claude-haiku-4')],
} as unknown as ProviderCatalog;

const azureProvider = {
  name: 'azure',
  displayName: 'Azure OpenAI',
  apiFormat: 'openai',
  endpointMode: 'per-credential',
  catalogSource: 'none',
  authMethods: ['api-key', 'env'],
  models: [],
} as unknown as ProviderCatalog;

const openrouterProvider = {
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalogSource: 'openrouter-api',
  authMethods: ['api-key'],
  models: [],
  catalogError: 'OpenRouter API unreachable',
} as unknown as ProviderCatalog;

function credential(
  overrides: Partial<Omit<MaskedCredential, 'id'>> & {
    id: string;
    name: string;
  },
): MaskedCredential {
  return {
    providerSlug: 'anthropic',
    authMethod: 'api-key',
    isDefault: false,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as unknown as MaskedCredential;
}

const defaultCredentials = [
  credential({
    id: 'cred-1',
    name: 'Production key',
    authMethod: 'api-key',
    maskedPreview: 'sk-a…4f2',
    isDefault: true,
  }),
  credential({
    id: 'cred-2',
    name: 'Ops key',
    authMethod: 'env',
    envName: 'TALE_PROVIDER_KEY_ANTHROPIC',
  }),
  credential({
    id: 'cred-3',
    name: 'Claude subscription',
    authMethod: 'subscription-broker',
    maskedPreview: 'tok…9zz',
    status: 'disabled',
    modelAllowlist: ['claude-fable-5'],
  }),
];

/** Open the add flow and pick a provider, returning its setup step. */
async function pickProvider(
  user: Awaited<ReturnType<typeof render>>['user'],
  name: string,
) {
  await user.click(screen.getByRole('button', { name: 'Add credential' }));
  const picker = within(
    await screen.findByRole('dialog', { name: 'Add credential' }),
  );
  await user.click(picker.getByRole('button', { name: new RegExp(name) }));
  return picker;
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    abilityState.canRead = true;
    fixtures.catalogs = [anthropicProvider, openrouterProvider];
    fixtures.credentials = [...defaultCredentials];
    fixtures.catalogsError = null;
  });

  it('lists one row per credential with its provider and status', async () => {
    const { container } = renderPage();

    const rows = screen.getAllByRole('row');
    // Header + three credentials — the twelve shipped providers are NOT rows.
    expect(rows).toHaveLength(4);

    expect(screen.getByText('Production key')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getAllByText('Anthropic').length).toBeGreaterThan(0);

    await checkAccessibility(container);
  });

  it('carries a failed catalog onto every row that depends on it', () => {
    fixtures.credentials = [
      credential({ id: 'c', name: 'Key', providerSlug: 'openrouter' }),
    ];
    renderPage();
    // Keys are useless if we cannot tell which models the provider serves, so
    // the failure rides the row rather than a badge on a card that is gone.
    expect(screen.getByText(/OpenRouter API unreachable/)).toBeInTheDocument();
  });

  it('names a credential whose provider left the catalog by its stored slug', () => {
    fixtures.catalogs = [openrouterProvider];
    fixtures.credentials = [
      credential({ id: 'c', name: 'Orphan key', providerSlug: 'anthropic' }),
    ];
    renderPage();
    // Hiding it would hide a live secret.
    expect(screen.getByText('Orphan key')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
  });

  it('warns, per provider, when credentials exist but none is the default', () => {
    fixtures.credentials = [credential({ id: 'cred-1', name: 'Only key' })];
    renderPage();
    expect(
      screen.getByText(/No default credential for Anthropic/),
    ).toBeInTheDocument();
  });

  describe('narrowing', () => {
    it('finds a credential by the provider it authenticates', async () => {
      fixtures.credentials = [
        ...defaultCredentials,
        credential({
          id: 'c4',
          name: 'Router key',
          providerSlug: 'openrouter',
        }),
      ];
      const { user } = renderPage();
      await user.type(
        screen.getByPlaceholderText('Search credentials'),
        'OpenRouter',
      );
      expect(screen.getByText('Router key')).toBeInTheDocument();
      expect(screen.queryByText('Production key')).not.toBeInTheDocument();
    });

    it('narrows by provider', async () => {
      fixtures.credentials = [
        ...defaultCredentials,
        credential({
          id: 'c4',
          name: 'Router key',
          providerSlug: 'openrouter',
        }),
      ];
      const { user } = renderPage();
      await pickFilterOption(user, 'Provider', 'OpenRouter');
      expect(screen.getByText('Router key')).toBeInTheDocument();
      expect(screen.queryByText('Production key')).not.toBeInTheDocument();
    });

    it('drops the provider facet when every credential shares one provider', () => {
      renderPage();
      // Nothing left to choose between, so the affordance goes away entirely
      // rather than opening onto a single option.
      expect(
        screen.queryByRole('button', { name: 'Filter' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the add flow', () => {
    it('leads with the providers already in use, then the rest alphabetically', async () => {
      fixtures.catalogs = [
        openrouterProvider,
        azureProvider,
        anthropicProvider,
      ];
      const { user } = renderPage();
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const picker = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );

      // Only the in-use group is titled: it is the one that needs telling
      // apart, so the rest follow it unheaded.
      expect(
        picker.getByRole('heading', { name: 'In use' }),
      ).toBeInTheDocument();
      // The rest deliberately carry NO heading — `vendor-picker-pane` passes a
      // null label for the `available` group, so "In use" is the only section
      // header and everything after it is simply the remainder.
      expect(
        picker.queryByRole('heading', { name: 'Available' }),
      ).not.toBeInTheDocument();

      // Anthropic holds every credential, so it leads despite sorting last of
      // the three; the unconfigured two follow in alphabetical order.
      const names = picker
        .getAllByRole('button')
        .map((button) => button.textContent ?? '')
        .filter((text) => /Anthropic|Azure|OpenRouter/.test(text));
      expect(names[0]).toMatch(/Anthropic/);
      expect(names[1]).toMatch(/Azure OpenAI/);
      expect(names[2]).toMatch(/OpenRouter/);
    });

    it('offers exactly the picked provider’s declared auth methods', async () => {
      const { user } = renderPage();
      const form = await pickProvider(user, 'Anthropic');
      await user.click(
        form.getByRole('combobox', { name: /Authentication method/ }),
      );
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['API key', 'Environment variable', 'Subscription broker']);
    });

    it('creates an api-key credential without ever rendering the secret', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      const { user } = renderPage();
      const form = await pickProvider(user, 'Anthropic');

      await user.type(
        form.getByRole('textbox', { name: /^Name/ }),
        'Staging key',
      );
      await user.type(
        form.getByLabelText(/^API key/, { selector: 'input' }),
        'sk-ant-secret',
      );
      await user.click(form.getByRole('button', { name: 'Add credential' }));

      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: 'anthropic',
          authMethod: 'api-key',
          name: 'Staging key',
          secret: 'sk-ant-secret',
        }),
      );
      expect(screen.queryByText('sk-ant-secret')).toBeNull();
      await waitFor(() =>
        expect(screen.queryByDisplayValue('sk-ant-secret')).toBeNull(),
      );
    });

    it('steps back to the catalog without keeping the abandoned draft', async () => {
      const { user } = renderPage();
      const form = await pickProvider(user, 'Anthropic');
      await user.type(form.getByRole('textbox', { name: /^Name/ }), 'Draft');

      await user.click(
        form.getByRole('button', { name: /Back to the catalog/ }),
      );
      await user.click(form.getByRole('button', { name: /Anthropic/ }));

      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue('');
    });

    it('prefixes the env-var name and requires an instance URL where the provider has one', async () => {
      fixtures.catalogs = [azureProvider];
      fixtures.credentials = [];
      const { user } = renderPage();
      const form = await pickProvider(user, 'Azure OpenAI');

      await user.type(form.getByRole('textbox', { name: /^Name/ }), 'Prod');
      await user.type(
        form.getByLabelText(/^API key/, { selector: 'input' }),
        'azure-key',
      );
      const submit = form.getByRole('button', { name: 'Add credential' });
      expect(submit).toBeDisabled();

      await user.type(
        form.getByRole('textbox', { name: /^Endpoint/ }),
        'https://acme.openai.azure.com/openai/v1',
      );
      await user.click(submit);
      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: 'azure',
          authMethod: 'api-key',
          name: 'Prod',
          secret: 'azure-key',
          endpointUrl: 'https://acme.openai.azure.com/openai/v1',
        }),
      );
    });

    it('says the deployment ships nothing rather than showing an empty catalog', async () => {
      fixtures.catalogs = [];
      fixtures.credentials = [];
      const { user } = renderPage();
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      expect(
        await screen.findByText(/ships no provider files/),
      ).toBeInTheDocument();
    });
  });

  describe('row actions', () => {
    it('deletes only after an explicit confirm, warning on the default', async () => {
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Production key' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      expect(confirm.getByText(/leaves no default/i)).toBeInTheDocument();
      await user.click(confirm.getByRole('button', { name: /Delete/ }));
      await waitFor(() =>
        expect(deleteCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          credentialId: 'cred-1',
        }),
      );
    });

    it('keeps make-default visible but inert on a disabled credential', async () => {
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Claude subscription' }),
      );
      expect(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Make default',
        }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(setDefaultCredential).not.toHaveBeenCalled();
    });

    it('offers no edit for a credential whose provider left the catalog', async () => {
      fixtures.catalogs = [openrouterProvider];
      fixtures.credentials = [
        credential({ id: 'c', name: 'Orphan key', providerSlug: 'anthropic' }),
      ];
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Orphan key' }),
      );
      const menu = within(await screen.findByRole('menu'));
      // Nothing to edit it against — but it can still be disabled or deleted.
      expect(
        menu.queryByRole('menuitem', { name: 'Edit credential' }),
      ).not.toBeInTheDocument();
      expect(
        menu.getByRole('menuitem', { name: 'Delete' }),
      ).toBeInTheDocument();
    });
  });

  describe('catalog refresh', () => {
    it('reports the per-provider outcome, falling back to the slug', async () => {
      refreshCatalogs.mockResolvedValue([
        { name: 'openrouter', modelCount: 342 },
        { name: 'vercel-ai-gateway', modelCount: 0, error: 'gateway down' },
      ]);
      const { user } = renderPage();
      await user.click(screen.getByRole('button', { name: /Refresh/ }));

      await waitFor(() =>
        expect(refreshCatalogs).toHaveBeenCalledWith({
          organizationId: 'org-1',
        }),
      );
      expect(await screen.findByText(/342 models/)).toBeInTheDocument();
      // A provider absent from the catalog listing still gets named.
      expect(
        screen.getByText(/vercel-ai-gateway.*gateway down/),
      ).toBeInTheDocument();
    });
  });

  describe('degradation', () => {
    it('surfaces a whole-catalog failure instead of an empty table', () => {
      fixtures.catalogs = [];
      fixtures.catalogsError = { data: { message: 'config root missing' } };
      renderPage();
      expect(screen.getByText(/config root missing/)).toBeInTheDocument();
    });

    it('refuses the page without the developer capability', () => {
      abilityState.canRead = false;
      renderPage();
      expect(screen.queryByText('Production key')).not.toBeInTheDocument();
    });
  });
});
