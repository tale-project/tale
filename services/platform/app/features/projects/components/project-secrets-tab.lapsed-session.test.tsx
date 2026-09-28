import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  LAPSED_SESSION_ANSWER,
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, within } from '@/tests/utils/render';

import { ProjectSecretsTab } from './project-secrets-tab';

// The whole write lane runs for real — the secrets hooks, `useBackendAction`,
// the adapter row, `backendFetch` — against the session door's own 401, and
// the real toast renders, so the test sees every toast a refused save raises,
// the hook's default included.
vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: [{ name: 'OPENAI_API_KEY' }],
    isLoading: false,
    error: null,
    isError: false,
  }),
}));
vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: {}, isLoading: false }),
}));
// The remove confirmation's error boundary reads the org id from the router.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

/** A label as the editor shows it in the current language. */
const envEditor = (key: string) => i18n.t(key, { ns: 'envEditor' });

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json(LAPSED_SESSION_ANSWER.body, {
      status: LAPSED_SESSION_ANSWER.status,
    }),
  );
});

afterEach(async () => {
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

describe('ProjectSecretsTab after a lapsed session', () => {
  describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
    it.each(['a new variable', 'a removed variable'] as const)(
      'says once that the session ended when saving %s',
      async (edit) => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        const { user } = render(
          <QueryClientProvider client={new QueryClient()}>
            <ProjectSecretsTab organizationId="org-1" projectId="proj-1" />
            <Toaster />
          </QueryClientProvider>,
        );

        if (edit === 'a new variable') {
          await user.click(
            screen.getByRole('button', { name: envEditor('add') }),
          );
          const [, name] = screen.getAllByPlaceholderText(
            envEditor('keyPlaceholder'),
          );
          await user.type(name, 'MY_SECRET');
          const [, value] = screen.getAllByPlaceholderText(
            envEditor('valuePlaceholder'),
          );
          await user.type(value, 'super-secret');
        } else {
          await user.click(
            screen.getByRole('button', { name: envEditor('remove') }),
          );
          const dialog = await screen.findByRole('dialog');
          await user.click(
            within(dialog).getByRole('button', { name: envEditor('remove') }),
          );
        }
        await user.click(
          screen.getByRole('button', { name: envEditor('save') }),
        );

        expect(await screen.findByText(SESSION_ENDED[locale])).toBeVisible();
        expect(screen.getByText(envEditor('saveError'))).toBeVisible();
        expect(screen.queryByText(/"code"/)).not.toBeInTheDocument();
        // One failure, one toast: the hook's default toast stays silent.
        expect(toast).toHaveBeenCalledTimes(1);
      },
    );
  });
});
