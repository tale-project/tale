// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendApiErrorFromBody } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

const { backendFetch, notices } = vi.hoisted(() => ({
  backendFetch: vi.fn(),
  notices: vi.fn(),
}));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch,
}));
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tale/ui/use-toast')>();
  const notify: typeof original.toast = (...args) => {
    notices(...args);
    return original.toast(...args);
  };
  return {
    ...original,
    toast: notify,
    useToast: () => ({ ...original.useToast(), toast: notify }),
  };
});
let saved = {
  customInstructionsEnabled: true,
  customInstructions: 'Be terse.',
};
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: saved, isLoading: false }),
}));
vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useGovernancePolicy: () => ({ data: { config: { enabled: false } } }),
}));

import { PreferencesSettings } from './preferences-settings';

function mount() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const view = () => (
    <QueryClientProvider client={client}>
      <PreferencesSettings organizationId="org-1" />
      <Toaster />
    </QueryClientProvider>
  );
  return { client, view, ...render(view()) };
}

beforeEach(() => {
  vi.clearAllMocks();
  saved = { customInstructionsEnabled: true, customInstructions: 'Be terse.' };
  backendFetch.mockImplementation(() => {
    saved = {
      ...saved,
      customInstructionsEnabled: !saved.customInstructionsEnabled,
    };
    return Promise.resolve({ ok: true });
  });
});
afterEach(async () => {
  cleanup();
  await forgetSavedLocale();
  toast({ open: false });
});

describe('Custom instructions immediate save', () => {
  it.each(SHIPPED_LOCALES)(
    'reports a 503 once, retains the saved value and permits retry (%s)',
    async (locale) => {
      saveLocale(locale);
      backendFetch.mockRejectedValueOnce(
        backendApiErrorFromBody(503, { error: 'private upstream payload' }),
      );
      const { user, client, rerender, view } = mount();
      await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));
      const toggle = screen.getByRole('switch');
      await user.click(toggle);
      const errorCopy = i18n.t('errors.toggleFailed', {
        ns: 'personalization',
      });
      expect(await screen.findByText(errorCopy)).toBeVisible();
      await waitFor(() =>
        expect(client.getMutationCache().getAll()[0]?.state.status).toBe(
          'error',
        ),
      );
      expect(notices).toHaveBeenCalledTimes(1);
      expect(notices).toHaveBeenCalledWith({
        title: errorCopy,
        description: undefined,
        variant: 'destructive',
      });
      expect(toggle).toBeChecked();
      expect(toggle).toBeEnabled();
      expect(screen.getByRole('textbox')).toHaveValue('Be terse.');
      expect(saved.customInstructionsEnabled).toBe(true);
      expect(screen.queryByText(/private upstream payload/)).toBeNull();
      await user.click(toggle);
      await waitFor(() => expect(notices).toHaveBeenCalledTimes(2));
      expect(backendFetch).toHaveBeenLastCalledWith(
        '/user-preferences/custom-instructions-enabled',
        { orgId: 'org-1', body: { enabled: false } },
      );
      rerender(view());
      expect(toggle).not.toBeChecked();
      expect(screen.queryByRole('textbox')).toBeNull();
      const success = i18n.t('toasts.preferencesUpdated', {
        ns: 'personalization',
      });
      expect(notices).toHaveBeenLastCalledWith({ title: success });
      expect(await screen.findByText(success)).toBeVisible();
    },
  );
  it('reports a successful toggle exactly once', async () => {
    const { user, rerender, view } = mount();
    await user.click(screen.getByRole('switch'));
    await waitFor(() => expect(notices).toHaveBeenCalledTimes(1));
    expect(notices).toHaveBeenCalledWith({
      title: i18n.t('toasts.preferencesUpdated', { ns: 'personalization' }),
    });
    rerender(view());
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('includes safe refusal words with the failure notification', async () => {
    backendFetch.mockRejectedValueOnce(
      backendApiErrorFromBody(403, {
        code: 'ROLE_FORBIDDEN',
        error: 'Your role cannot change this preference.',
      }),
    );
    const { user } = mount();
    await user.click(screen.getByRole('switch'));
    expect(
      await screen.findByText('Your role cannot change this preference.'),
    ).toBeVisible();
    expect(notices).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('switch')).toBeChecked();
  });
});
