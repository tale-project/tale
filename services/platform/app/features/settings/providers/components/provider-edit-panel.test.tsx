// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-1' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' }),
  useRouter: () => ({}),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/features/organization/hooks/queries', () => ({
  useOrganization: () => ({
    data: {
      slug: 'default',
      // No metadata.defaultLocale → falls through to app default 'en'.
      metadata: undefined,
    },
  }),
}));

const saveConfigMock = vi.fn();
const configMock = vi.fn();
vi.mock('../hooks/use-provider-config-context', () => ({
  useProviderConfig: () => ({
    config: configMock(),
    isSaving: false,
    saveConfig: saveConfigMock,
  }),
}));

vi.mock('../utils/error-dispatch', () => ({
  dispatchForbiddenDeveloperSettings: () => false,
  dispatchOrgAccessError: () => false,
  dispatchVersionConflict: () => false,
}));

import { ProviderEditPanel } from './provider-edit-panel';

const baseConfig = {
  displayName: 'OpenRouter',
  description: 'Multi-model gateway',
  baseUrl: 'https://openrouter.ai/api/v1',
  models: [{ id: 'm1', displayName: 'M1', tags: ['chat'] }],
};

function renderPanel() {
  return render(
    <ProviderEditPanel
      open
      onOpenChange={vi.fn()}
      providerName="openrouter"
      organizationId="org-1"
    />,
  );
}

async function clickGermanTab(user: ReturnType<typeof userEvent.setup>) {
  const deTab = await screen.findByRole('tab', { name: /languages\.de/i });
  await user.click(deTab);
}

function getDisplayNameInput() {
  return screen.getByRole('textbox', {
    name: /^settings\.providers\.displayName\b/i,
  });
}

function getDescriptionInput() {
  return screen.getByRole('textbox', {
    name: /^settings\.providers\.description_field\b/i,
  });
}

async function clickSubmit(user: ReturnType<typeof userEvent.setup>) {
  const submitButton = await screen.findByRole('button', {
    name: /providers\.saveChanges/i,
  });
  await user.click(submitButton);
  await waitFor(() => expect(saveConfigMock).toHaveBeenCalledTimes(1));
  return saveConfigMock.mock.calls[0][0];
}

describe('ProviderEditPanel', () => {
  beforeEach(() => {
    saveConfigMock.mockReset();
    saveConfigMock.mockResolvedValue(undefined);
  });

  it('writes a non-default-locale edit into i18n[locale]', async () => {
    configMock.mockReturnValue({ ...baseConfig });
    const { user } = renderPanel();

    await clickGermanTab(user);
    await user.type(getDisplayNameInput(), 'OpenRouter DE');
    await user.type(getDescriptionInput(), 'Deutsche Beschreibung');

    const payload = await clickSubmit(user);
    expect(payload.displayName).toBe('OpenRouter');
    expect(payload.description).toBe('Multi-model gateway');
    expect(payload.i18n).toEqual({
      de: {
        displayName: 'OpenRouter DE',
        description: 'Deutsche Beschreibung',
      },
    });
  });

  it('drops a non-default locale entry when both fields are emptied', async () => {
    configMock.mockReturnValue({
      ...baseConfig,
      i18n: {
        de: {
          displayName: 'OpenRouter DE',
          description: 'Deutsche Beschreibung',
        },
      },
    });
    const { user } = renderPanel();

    await clickGermanTab(user);
    await user.clear(getDisplayNameInput());
    await user.clear(getDescriptionInput());

    const payload = await clickSubmit(user);
    expect(payload.i18n).toBeUndefined();
  });

  it('preserves existing i18n[locale].models overrides when only provider-level fields change', async () => {
    configMock.mockReturnValue({
      ...baseConfig,
      i18n: {
        de: {
          description: 'old german',
          models: { m1: { description: 'altes Modell' } },
        },
      },
    });
    const { user } = renderPanel();

    await clickGermanTab(user);
    await user.clear(getDescriptionInput());
    await user.type(getDescriptionInput(), 'neue Beschreibung');

    const payload = await clickSubmit(user);
    expect(payload.i18n?.de.description).toBe('neue Beschreibung');
    expect(payload.i18n?.de.models).toEqual({
      m1: { description: 'altes Modell' },
    });
  });

  it('preserves model overrides even when provider-level fields are emptied', async () => {
    configMock.mockReturnValue({
      ...baseConfig,
      i18n: {
        de: {
          description: 'will be cleared',
          models: { m1: { description: 'altes Modell' } },
        },
      },
    });
    const { user } = renderPanel();

    await clickGermanTab(user);
    await user.clear(getDescriptionInput());

    const payload = await clickSubmit(user);
    expect(payload.i18n?.de).toEqual({
      models: { m1: { description: 'altes Modell' } },
    });
  });

  function getBaseUrlInput() {
    return screen.getByRole('textbox', {
      name: /^settings\.providers\.baseUrl\b/i,
    });
  }

  it('persists apiFormat as undefined by default (clean for standard providers)', async () => {
    configMock.mockReturnValue({ ...baseConfig });
    const { user } = renderPanel();
    await user.type(getDisplayNameInput(), ' 2'); // dirty so submit is enabled
    const payload = await clickSubmit(user);
    expect(payload.apiFormat).toBeUndefined();
  });

  it('carries an existing anthropic apiFormat through save', async () => {
    configMock.mockReturnValue({ ...baseConfig, apiFormat: 'anthropic' });
    const { user } = renderPanel();
    await user.type(getDisplayNameInput(), ' 2');
    const payload = await clickSubmit(user);
    expect(payload.apiFormat).toBe('anthropic');
  });

  // #2653 — apiFormat only matters for exotic self-hosted setups, so it lives
  // inside a closed Advanced disclosure; the default stays OpenAI-compatible.
  it('renders apiFormat inside a closed Advanced disclosure, default unchanged', () => {
    configMock.mockReturnValue({ ...baseConfig });
    renderPanel();

    const apiFormat = screen.getByRole('combobox', {
      name: /^settings\.providers\.apiFormat\b/i,
    });
    const details = apiFormat.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent(/settings\.providers\.advanced/i);
    expect(apiFormat).toHaveTextContent(
      /settings\.providers\.apiFormatOpenai/i,
    );
  });

  it('lets the user switch the apiFormat to Anthropic', async () => {
    configMock.mockReturnValue({ ...baseConfig });
    const { user } = renderPanel();
    await user.click(
      screen.getByRole('combobox', {
        name: /^settings\.providers\.apiFormat\b/i,
      }),
    );
    await user.click(
      await screen.findByRole('option', {
        name: /settings\.providers\.apiFormatAnthropic/i,
      }),
    );
    const payload = await clickSubmit(user);
    expect(payload.apiFormat).toBe('anthropic');
  });

  // #2653 — a known catalog provider's endpoint is a published fact: the field
  // is locked (readOnly, still focusable/readable) behind an explicit override.
  it('locks the base URL for a known catalog provider until Override is clicked', async () => {
    configMock.mockReturnValue({ ...baseConfig });
    const { user } = renderPanel();

    const baseUrl = getBaseUrlInput();
    expect(baseUrl).toHaveAttribute('readonly');
    // Typing into the locked field must not change it.
    await user.type(baseUrl, '2');
    expect(baseUrl).toHaveValue('https://openrouter.ai/api/v1');

    await user.click(
      screen.getByRole('button', {
        name: /settings\.providers\.baseUrlOverride/i,
      }),
    );
    expect(getBaseUrlInput()).not.toHaveAttribute('readonly');
    await user.type(getBaseUrlInput(), '2');

    const payload = await clickSubmit(user);
    expect(payload.baseUrl).toBe('https://openrouter.ai/api/v12');
  });

  it('renders a stored custom base URL editable — existing configs unchanged (#2653)', async () => {
    configMock.mockReturnValue({
      ...baseConfig,
      baseUrl: 'https://proxy.example.com/v1',
    });
    const { user } = renderPanel();

    expect(getBaseUrlInput()).not.toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', {
        name: /settings\.providers\.baseUrlOverride/i,
      }),
    ).not.toBeInTheDocument();

    await user.type(getBaseUrlInput(), '2');
    const payload = await clickSubmit(user);
    expect(payload.baseUrl).toBe('https://proxy.example.com/v12');
  });
});
