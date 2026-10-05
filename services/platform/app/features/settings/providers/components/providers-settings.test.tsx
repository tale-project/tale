import { pickFilterOption } from '@tale/ui/testing/filters';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SettingsHeaderActionsSetter,
  type SettingsHeaderAction,
} from '@/app/features/settings/components/settings-secondary-action-context';
import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  saveLocale,
  forgetSavedLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

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
const checkCatalog = vi.hoisted(() => vi.fn());
const toastSpy = vi.hoisted(() => vi.fn());
const urlState = vi.hoisted(() => ({ provider: null as string | null }));
const setUrlState = vi.hoisted(() => vi.fn());

const fixtures = vi.hoisted(() => ({
  catalogs: [] as unknown[],
  credentials: [] as unknown[],
  catalogsError: null as unknown,
  /** What the dependents read answers for any credential. */
  dependents: [] as string[],
}));

vi.mock('../hooks/queries', () => ({
  providerCatalogsQueryKey: (organizationId: string) => [
    'providers',
    'catalogs',
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
  useCredentialDependents: (
    _organizationId: string,
    _credentialId: string,
    options?: { enabled?: boolean },
  ) => ({
    data:
      options?.enabled === false ? undefined : { usedBy: fixtures.dependents },
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
  useCheckProviderDefinitionCatalog: () => ({
    mutateAsync: checkCatalog,
    isPending: false,
  }),
}));

// The custom-provider composition (definition first, credential second,
// rollback on refusal) has its own hook test; the page sees the arguments
// the dialog assembles, custom facts included.
vi.mock('../hooks/custom-provider-mutations', () => ({
  useCreateProviderCredential: () => ({
    mutateAsync: createCredential,
    isPending: false,
  }),
  useUpdateProviderCredential: () => ({
    mutateAsync: updateCredential,
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
      const [provider, setProvider] = React.useState<string | null>(
        urlState.provider,
      );
      return {
        state: { provider },
        setState: (key: string, value: string | null) => {
          setUrlState(key, value);
          setProvider(value);
        },
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

vi.mock('@tale/ui/use-toast', () => ({
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
  // Anchored: the pinned custom entry's description names vendors too.
  await user.click(
    picker.getByRole('button', { name: new RegExp(`^${name}`) }),
  );
  return picker;
}

/** Replace the name the setup step suggests with the test's own. */
async function rename(
  user: Awaited<ReturnType<typeof render>>['user'],
  form: ReturnType<typeof within>,
  name: string,
) {
  const field = form.getByRole('textbox', { name: /^Name/ });
  await user.clear(field);
  await user.type(field, name);
}

describe('ProvidersSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    urlState.provider = null;
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

  it('says on a subscription row that it serves tasks and automations, never chat', () => {
    renderPage();
    // The broker row carries it; the api-key and env rows do not.
    expect(
      screen.getAllByText(
        'Tasks and automations only — chat needs an API key or environment variable',
      ),
    ).toHaveLength(1);
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
    describe('localized no-results recovery', () => {
      afterEach(async () => {
        cleanup();
        await forgetSavedLocale();
      });

      it.each(SHIPPED_LOCALES)(
        'keeps the filter keyboard-clearable in %s',
        async (locale) => {
          saveLocale(locale);
          await i18n.changeLanguage(locale);
          urlState.provider = 'openrouter';
          const { user, container } = renderPage();
          expect(
            await screen.findByRole('heading', {
              name: i18n.t('search.noResults', { ns: 'common' }),
            }),
          ).toBeInTheDocument();
          expect(
            screen.getByPlaceholderText(
              i18n.t('credentials.searchPlaceholder', { ns: 'settings' }),
            ),
          ).toBeEnabled();
          const filter = screen.getByRole('button', {
            name: new RegExp(i18n.t('labels.filter', { ns: 'common' })),
          });
          filter.focus();
          await user.keyboard('{Enter}');
          const group = screen.getByRole('button', {
            name: new RegExp(
              `^${i18n.t('providers.vendorFilterLabel', { ns: 'settings' })}`,
            ),
          });
          group.focus();
          await user.keyboard('{Enter}');
          const selected = screen.getByRole('checkbox', { name: 'OpenRouter' });
          expect(selected).toBeChecked();
          await checkAccessibility(container);
          selected.focus();
          await user.keyboard(' ');
          await user.keyboard('{Escape}');
          expect(screen.getByText('Production key')).toBeInTheDocument();
          expect(setUrlState).toHaveBeenCalledWith('provider', null);
        },
      );
    });

    it.each(['openrouter', 'retired-provider'])(
      'keeps an unmatched %s deep-link filter reversible',
      async (provider) => {
        urlState.provider = provider;
        const { user, container } = renderPage();
        expect(
          await screen.findByRole('heading', { name: 'No results found' }),
        ).toBeInTheDocument();
        expect(
          screen.queryByRole('heading', {
            name: 'Connect your first AI provider',
          }),
        ).not.toBeInTheDocument();
        expect(screen.getByPlaceholderText('Search credentials')).toBeEnabled();
        const filter = screen.getByRole('button', { name: /Filter/ });
        expect(filter).toBeEnabled();
        await checkAccessibility(container);
        await user.click(filter);
        await user.click(screen.getByRole('button', { name: /^Provider/ }));
        const option = screen.getByRole('checkbox', {
          name: provider === 'openrouter' ? 'OpenRouter' : provider,
        });
        expect(option).toBeChecked();
        await user.click(option);
        await user.keyboard('{Escape}');
        expect(screen.getByText('Production key')).toBeInTheDocument();
        expect(setUrlState).toHaveBeenCalledWith('provider', null);
      },
    );

    it('keeps a matching single-provider deep link clearable', async () => {
      urlState.provider = 'anthropic';
      const { user } = renderPage();
      await user.click(await screen.findByRole('button', { name: /Filter/ }));
      await user.click(
        within(screen.getByRole('dialog', { name: 'Filters' })).getByRole(
          'button',
          { name: 'Clear all' },
        ),
      );
      expect(setUrlState).toHaveBeenCalledWith('provider', null);
      expect(screen.getByText('Production key')).toBeInTheDocument();
    });

    it('keeps the active facet after deleting its last credential', async () => {
      const routerCredential = credential({
        id: 'router',
        name: 'Router key',
        providerSlug: 'openrouter',
        isDefault: true,
      });
      fixtures.credentials = [...defaultCredentials, routerCredential];
      const { user, rerender } = renderPage();
      await pickFilterOption(user, 'Provider', 'OpenRouter');
      await user.keyboard('{Escape}');
      await user.click(
        screen.getByRole('button', { name: 'Actions for Router key' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      await user.click(dialog.getByRole('button', { name: /Delete/ }));
      expect(deleteCredential).toHaveBeenCalledWith({
        organizationId: 'org-1',
        credentialId: 'router',
      });
      fixtures.credentials = [...defaultCredentials];
      rerender(
        <WithHeaderSlot>
          <ProvidersSettings organizationId="org-1" />
        </WithHeaderSlot>,
      );
      expect(
        await screen.findByRole('heading', { name: 'No results found' }),
      ).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search credentials')).toBeEnabled();
      await user.click(screen.getByRole('button', { name: /Filter/ }));
      await user.click(
        within(screen.getByRole('dialog', { name: 'Filters' })).getByRole(
          'button',
          { name: 'Clear all' },
        ),
      );
      expect(screen.getByText('Production key')).toBeInTheDocument();
    });

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
    it('leads with configured providers, badges them, then the rest alphabetically', async () => {
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

      expect(
        picker.queryByRole('heading', { name: 'In use' }),
      ).not.toBeInTheDocument();
      expect(picker.getByText('Configured')).toBeInTheDocument();

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

    it('explains before the broker fields that a subscription never serves chat, and why', async () => {
      const { user } = renderPage();
      const form = await pickProvider(user, 'Anthropic');
      // The direct method needs no such word.
      expect(form.queryByText('Tasks and automations only')).toBeNull();
      await user.click(
        form.getByRole('combobox', { name: /Authentication method/ }),
      );
      await user.click(
        screen.getByRole('option', { name: 'Subscription broker' }),
      );
      expect(form.getByText('Tasks and automations only')).toBeInTheDocument();
      expect(
        form.getByText(
          /vendors do not\s+permit these tokens in other applications/,
        ),
      ).toBeInTheDocument();
      // A static notice describes the method; it announces nothing.
      expect(form.queryByRole('alert')).toBeNull();
    });

    it('names the credential after its provider, numbered past a name that provider already holds', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      fixtures.credentials = [
        ...defaultCredentials,
        credential({
          id: 'c4',
          name: 'OpenRouter',
          providerSlug: 'openrouter',
        }),
      ];
      const { user } = renderPage();

      // Anthropic's three keys carry names of their own, so its name is free.
      const form = await pickProvider(user, 'Anthropic');
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'Anthropic',
      );
      await user.click(form.getByRole('button', { name: 'Back' }));

      await user.click(form.getByRole('button', { name: /OpenRouter/ }));
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'OpenRouter 2',
      );
      await user.type(
        form.getByLabelText(/^API key/, { selector: 'input' }),
        'sk-or-secret',
      );
      await user.click(form.getByRole('button', { name: 'Add credential' }));

      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: 'openrouter',
          authMethod: 'api-key',
          name: 'OpenRouter 2',
          secret: 'sk-or-secret',
        }),
      );
    });

    it('closes over an untouched suggestion without asking, but guards a typed name', async () => {
      const confirmSpy = vi
        .spyOn(globalThis, 'confirm')
        .mockImplementation(() => false);
      try {
        const { user } = renderPage();
        let form = await pickProvider(user, 'Anthropic');
        // The suggestion is the dialog's own words, not the reader's — there
        // is nothing to discard.
        await user.click(form.getByRole('button', { name: 'Cancel' }));
        expect(confirmSpy).not.toHaveBeenCalled();
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );

        form = await pickProvider(user, 'Anthropic');
        await rename(user, form, 'Staging key');
        await user.click(form.getByRole('button', { name: 'Cancel' }));
        expect(confirmSpy).toHaveBeenCalledOnce();
        expect(
          screen.getByRole('dialog', { name: 'Add credential' }),
        ).toBeInTheDocument();
      } finally {
        confirmSpy.mockRestore();
      }
    });

    it('creates an api-key credential without ever rendering the secret', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      const { user } = renderPage();
      const form = await pickProvider(user, 'Anthropic');

      await rename(user, form, 'Staging key');
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
      await rename(user, form, 'Draft');

      await user.click(form.getByRole('button', { name: 'Back' }));
      await user.click(form.getByRole('button', { name: /^Anthropic/ }));

      // The abandoned name is gone; the fresh step suggests again.
      expect(form.getByRole('textbox', { name: /^Name/ })).toHaveValue(
        'Anthropic',
      );
    });

    it('prefixes the env-var name and requires an instance URL where the provider has one', async () => {
      fixtures.catalogs = [azureProvider];
      fixtures.credentials = [];
      const { user } = renderPage();
      const form = await pickProvider(user, 'Azure OpenAI');

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
          // The suggested name, kept.
          name: 'Azure OpenAI',
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

    // The embedding model resolves its key through this credential: the
    // dialog says so before the server refuses the delete for it.
    it('warns that the embedding model uses the credential, and maps the refusal', async () => {
      fixtures.dependents = ['embedding'];
      deleteCredential.mockRejectedValueOnce(
        new AppError({
          code: 'CREDENTIAL_IN_USE',
          message: 'in use',
          data: { usedBy: ['embedding'] },
        }),
      );
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Ops key' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      expect(
        await confirm.findByText(
          /knowledge embedding model uses this credential/i,
        ),
      ).toBeInTheDocument();
      await user.click(confirm.getByRole('button', { name: /Delete/ }));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringMatching(
              /Could not delete the credential: The knowledge embedding model uses this credential/,
            ),
            variant: 'destructive',
          }),
        ),
      );
      fixtures.dependents = [];
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

  describe('the custom provider entry', () => {
    const customVendor = {
      name: 'qwen-cn',
      displayName: 'Qwen CN',
      origin: 'organization',
      apiFormat: 'openai',
      baseUrl: 'https://maas.example.test/v1',
      catalogSource: 'models-endpoint',
      authMethods: ['api-key', 'env'],
      models: [model('qwen-plus')],
      definitionHash: 'h1',
    } as unknown as ProviderCatalog;
    const customCredential = credential({
      id: 'c9',
      name: 'Qwen CN',
      providerSlug: 'qwen-cn',
      isDefault: true,
      hash: 'c1',
    });

    /** Open the add flow and pick the pinned custom entry. */
    async function pickCustom(
      user: Awaited<ReturnType<typeof render>>['user'],
    ) {
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.click(dialog.getByRole('button', { name: /Custom provider/ }));
      return dialog;
    }

    it('pins the entry under the catalog, whatever the search says', async () => {
      const { user } = renderPage();
      await user.click(screen.getByRole('button', { name: 'Add credential' }));
      const picker = within(
        await screen.findByRole('dialog', { name: 'Add credential' }),
      );
      await user.type(picker.getByPlaceholderText('Search provider'), 'zzzz');
      expect(
        picker.getByText('Nothing matches that search.'),
      ).toBeInTheDocument();
      expect(
        picker.getByRole('button', { name: /Custom provider/ }),
      ).toBeInTheDocument();
    });

    it('creates the provider and its key from one form, with the facts the reader typed', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      const { user } = renderPage();
      const dialog = await pickCustom(user);
      // No vendor name to suggest: the reader names the provider.
      const name = dialog.getByRole('textbox', { name: /^Provider name/ });
      expect(name).toHaveValue('');
      await user.type(name, 'Qwen CN');
      await user.type(
        dialog.getByLabelText(/^API key/, { selector: 'input' }),
        'sk-qwen',
      );
      const submit = dialog.getByRole('button', { name: 'Add credential' });
      // The base URL is as mandatory as the key.
      expect(submit).toBeDisabled();
      await user.type(
        dialog.getByRole('textbox', { name: /^Base URL/ }),
        'https://maas.example.test/v1',
      );
      await user.click(
        dialog.getByRole('radio', { name: /Anthropic Messages API/ }),
      );
      await user.click(submit);
      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          providerSlug: '__custom-provider__',
          authMethod: 'api-key',
          name: 'Qwen CN',
          secret: 'sk-qwen',
          customProvider: {
            providerSlug: '__custom-provider__',
            apiFormat: 'anthropic',
            baseUrl: 'https://maas.example.test/v1',
            catalogSource: 'models-endpoint',
          },
        }),
      );
    });

    it('requires model ids when the endpoint cannot list them', async () => {
      createCredential.mockResolvedValue({ credentialId: 'cred-9' });
      const { user } = renderPage();
      const dialog = await pickCustom(user);
      await user.type(
        dialog.getByRole('textbox', { name: /^Provider name/ }),
        'Local',
      );
      await user.type(
        dialog.getByLabelText(/^API key/, { selector: 'input' }),
        'sk-local',
      );
      await user.type(
        dialog.getByRole('textbox', { name: /^Base URL/ }),
        'https://models.example.test/v1',
      );
      await user.click(dialog.getByRole('radio', { name: /Enter model IDs/ }));
      const submit = dialog.getByRole('button', { name: 'Add credential' });
      expect(submit).toBeDisabled();
      await user.type(
        dialog.getByPlaceholderText('gpt-4o, o4-mini'),
        'llama-4, qwen-3',
      );
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() =>
        expect(createCredential).toHaveBeenCalledWith(
          expect.objectContaining({
            modelAllowlist: ['llama-4', 'qwen-3'],
            customProvider: expect.objectContaining({ catalogSource: 'none' }),
          }),
        ),
      );
    });

    it('marks an organization-defined provider in the table and retires it with its last credential', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential];
      deleteCredential.mockResolvedValue(null);
      const { user } = renderPage();
      expect(screen.getByText('Custom')).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Delete',
        }),
      );
      const confirm = within(
        await screen.findByRole('dialog', { name: 'Delete credential' }),
      );
      expect(
        confirm.getByText(/only credential of the custom provider "Qwen CN"/),
      ).toBeInTheDocument();
      await user.click(confirm.getByRole('button', { name: /Delete/ }));
      await waitFor(() =>
        expect(deleteCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          credentialId: 'c9',
          retireUnusedCustomProvider: true,
        }),
      );
    });

    it('lists the provider’s models afresh from the row menu', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential];
      checkCatalog.mockResolvedValue([model('qwen-plus'), model('qwen-max')]);
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Check models',
        }),
      );
      await waitFor(() =>
        expect(checkCatalog).toHaveBeenCalledWith({
          organizationId: 'org-1',
          name: 'qwen-cn',
        }),
      );
      expect(toastSpy).toHaveBeenCalledWith({
        title: 'Qwen CN: 2 models listed',
      });
    });

    it('edits the provider’s facts beside its credential', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential];
      updateCredential.mockResolvedValue(null);
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      const baseUrl = dialog.getByRole('textbox', { name: /^Base URL/ });
      expect(baseUrl).toHaveValue('https://maas.example.test/v1');
      await user.clear(baseUrl);
      await user.type(baseUrl, 'https://maas.example.test/v2');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateCredential).toHaveBeenCalledWith({
          organizationId: 'org-1',
          credentialId: 'c9',
          name: 'Qwen CN',
          modelAllowlist: null,
          customProvider: {
            providerSlug: 'qwen-cn',
            apiFormat: 'openai',
            baseUrl: 'https://maas.example.test/v2',
            catalogSource: 'models-endpoint',
          },
          // The versions the facts on screen were read at.
          reviewed: { credentialHash: 'c1', definitionHash: 'h1' },
        }),
      );
    });

    it('opens on the facts and versions the listing holds now, not the ones it first rendered', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential];
      updateCredential.mockResolvedValue(null);
      const { rerender, user } = renderPage();
      // Another session moved the provider to v2: the listing refetched.
      fixtures.catalogs = [
        anthropicProvider,
        {
          ...customVendor,
          baseUrl: 'https://maas.example.test/v2',
          definitionHash: 'h2',
        },
      ];
      fixtures.credentials = [{ ...customCredential, hash: 'c2' }];
      rerender(
        <WithHeaderSlot>
          <ProvidersSettings organizationId="org-1" />
        </WithHeaderSlot>,
      );
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      expect(dialog.getByRole('textbox', { name: /^Base URL/ })).toHaveValue(
        'https://maas.example.test/v2',
      );
      const name = dialog.getByRole('textbox', { name: /^Provider name/ });
      await user.clear(name);
      await user.type(name, 'Qwen China');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateCredential).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Qwen China',
            customProvider: expect.objectContaining({
              baseUrl: 'https://maas.example.test/v2',
            }),
            reviewed: { credentialHash: 'c2', definitionHash: 'h2' },
          }),
        ),
      );
    });

    it('keeps an open edit dialog, and what was typed in it, when the list refetches', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential, ...defaultCredentials];
      const { rerender, user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      const name = dialog.getByRole('textbox', { name: /^Provider name/ });
      await user.clear(name);
      await user.type(name, 'Qwen typed');
      // Another session saves a credential: the hint refetches the list.
      fixtures.credentials = [customCredential, ...defaultCredentials.slice(1)];
      rerender(
        <WithHeaderSlot>
          <ProvidersSettings organizationId="org-1" />
        </WithHeaderSlot>,
      );
      expect(
        screen.getByRole('dialog', { name: 'Edit credential' }),
      ).toBeInTheDocument();
      expect(
        within(
          screen.getByRole('dialog', { name: 'Edit credential' }),
        ).getByRole('textbox', { name: /^Provider name/ }),
      ).toHaveValue('Qwen typed');
    });

    it('shows the refusal of an edit the provider moved under, inline', async () => {
      fixtures.catalogs = [anthropicProvider, customVendor];
      fixtures.credentials = [customCredential];
      updateCredential.mockRejectedValue(
        new AppError({
          code: 'CONFIG_VERSION_CONFLICT',
          message: 'The provider changed since it was loaded.',
        }),
      );
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      const name = dialog.getByRole('textbox', { name: /^Provider name/ });
      await user.clear(name);
      await user.type(name, 'Qwen China');
      await user.click(dialog.getByRole('button', { name: 'Save' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent(
        'The provider changed since it was loaded. Reopen the dialog and try again.',
      );
    });

    it('shows back in manual entry the model ids Save sends after discovery removed one', async () => {
      fixtures.catalogs = [
        anthropicProvider,
        { ...customVendor, catalogSource: 'none', models: [] },
      ];
      fixtures.credentials = [
        { ...customCredential, modelAllowlist: ['alpha', 'beta'] },
      ];
      updateCredential.mockResolvedValue(null);
      const { user } = renderPage();
      await user.click(
        screen.getByRole('button', { name: 'Actions for Qwen CN' }),
      );
      await user.click(
        within(await screen.findByRole('menu')).getByRole('menuitem', {
          name: 'Edit credential',
        }),
      );
      const dialog = within(
        await screen.findByRole('dialog', { name: 'Edit credential' }),
      );
      const ids = () =>
        dialog.getByRole('textbox', { name: /^Model allowlist/ });
      expect(ids()).toHaveValue('alpha, beta');

      await user.click(
        dialog.getByRole('radio', { name: /Discover from the endpoint/ }),
      );
      await user.click(dialog.getByRole('button', { name: 'Remove alpha' }));
      await user.click(dialog.getByRole('radio', { name: /Enter model IDs/ }));
      // The field says what the Save below sends, not what it opened with.
      expect(ids()).toHaveValue('beta');

      await user.click(dialog.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(updateCredential).toHaveBeenCalledWith(
          expect.objectContaining({
            modelAllowlist: ['beta'],
            customProvider: expect.objectContaining({ catalogSource: 'none' }),
          }),
        ),
      );
    });
  });
});
