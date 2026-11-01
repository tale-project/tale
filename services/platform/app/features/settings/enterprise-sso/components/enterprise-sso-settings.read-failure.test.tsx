import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from '@tanstack/react-query';
import type { Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { EnterpriseSsoSettings } from './enterprise-sso-settings';

/**
 * Settings › Enterprise SSO over its real read: `useEnterpriseSso`, the
 * adapter row, `backendFetch` and the read retry policy (four attempts for a
 * fault, one for a refusal) against a closed synthetic transport. A read
 * that failed is named with **Try again** and never passes for a connection
 * still loading or an organization without SSO (#4653).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// The form is tested on its own; here it shows which connection it was
// handed, and holds the section a Try again that gave way focuses.
vi.mock('./enterprise-sso-form', () => ({
  EnterpriseSsoForm: ({
    config,
    sectionRef,
  }: {
    config?: { displayName?: string };
    sectionRef?: Ref<HTMLElement>;
  }) => (
    <section ref={sectionRef} tabIndex={-1} aria-label="Connection form">
      <p>
        {config === undefined
          ? 'No connection handed over'
          : `Connection: ${config.displayName ?? 'none'}`}
      </p>
    </section>
  ),
}));
vi.mock(
  '@/app/features/settings/trusted-headers/components/trusted-headers-section',
  () => ({ TrustedHeadersSection: () => null }),
);
vi.mock(
  '@/app/features/settings/trusted-headers/components/embedding-section',
  () => ({ EmbeddingSection: () => null }),
);
// The viewer's role, and whether it is still loading; an Admin by default.
const viewer = vi.hoisted(() => ({ role: 'admin', loading: false }));
vi.mock('@/app/hooks/use-ability', async () => {
  const { defineAbilityFor } = await import('@/lib/permissions/ability');
  return {
    useAbility: () =>
      defineAbilityFor(viewer.loading ? 'disabled' : viewer.role),
    useAbilityLoading: () => viewer.loading,
  };
});

const CONNECTION = /^GET \/api\/app\/sso\/config\?orgId=org-1$/;

function connectionAnswer(displayName: string) {
  return () => Response.json({ configured: true, displayName });
}

/** The refusal `getSsoConnectionView` answers for a connection.yml it
 * cannot read (#4264). */
const UNREADABLE =
  'The SSO connection configuration for acme could not be read; repair connection.yml before continuing.';
function unreadableConnection() {
  return Response.json(
    { error: 'sso_config_unreadable', message: UNREADABLE },
    { status: 409 },
  );
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  viewer.role = 'admin';
  viewer.loading = false;
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/enterprise-sso',
  );
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  // Unmount before the language is put back, so no mounted label re-renders
  // outside act.
  cleanup();
  client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function page() {
  return (
    <QueryClientProvider client={client}>
      <EnterpriseSsoSettings organizationId="org-1" />
    </QueryClientProvider>
  );
}

async function renderPage() {
  const view = render(page());
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

const text = (key: string) => i18n.t(key, { ns: 'settings' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe(
  'EnterpriseSsoSettings when its connection read fails',
  { timeout: 30_000 },
  () => {
    it('names a failed read with Try again instead of a blank form, and recovers from the keyboard', async () => {
      backend.on(CONNECTION, serviceUnavailable);
      const { user } = await renderPage();

      await waitFor(() => expect(backend.count(CONNECTION)).toBe(4));
      // A fault says nothing about the saved connection: no repair notice.
      expect(screen.queryByText(/repair/i)).not.toBeInTheDocument();
      // And it has no words of its own to add to the page's.
      const alert = await alertSaying(text('enterpriseSso.loadFailed'));
      expect(
        screen.queryByRole('region', { name: 'Connection form' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();

      backend.on(CONNECTION, connectionAnswer('Acme Entra'));
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByText('Connection: Acme Entra'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(text('enterpriseSso.loadFailed')),
      ).not.toBeInTheDocument();
      expect(backend.count(CONNECTION)).toBe(5);
      // Try again gave way to the form: its focus is on the form's section,
      // not lost to the page.
      await waitFor(() =>
        expect(
          screen.getByRole('region', { name: 'Connection form' }),
        ).toHaveFocus(),
      );
    });

    it('says why an unreadable connection.yml refused, and keeps saying it through a retry', async () => {
      backend.on(CONNECTION, unreadableConnection);
      const { user } = await renderPage();

      // A refusal is not retried by the policy: one request settles it.
      const alert = await alertSaying(
        `${text('enterpriseSso.loadFailed')} ${UNREADABLE}`,
      );
      expect(backend.count(CONNECTION)).toBe(1);
      expect(
        screen.queryByRole('region', { name: 'Connection form' }),
      ).not.toBeInTheDocument();

      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(backend.count(CONNECTION)).toBe(2));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(
        screen.getByText(`${text('enterpriseSso.loadFailed')} ${UNREADABLE}`),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
      expect(retry).toHaveFocus();
      expect(
        screen.queryByRole('region', { name: 'Connection form' }),
      ).not.toBeInTheDocument();
    });

    it('masks the form while the first read waits, offline included', async () => {
      // Offline, react-query pauses the read before it starts: it is
      // neither loading nor failed, and nothing has answered.
      onlineManager.setOnline(false);
      backend.on(CONNECTION, connectionAnswer('Acme Entra'));
      await renderPage();

      expect(backend.count(CONNECTION)).toBe(0);
      const masked = screen.getByRole('status');
      expect(masked).toHaveAttribute('aria-busy', 'true');
      expect(masked).toContainElement(
        screen.getByText('No connection handed over'),
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await act(async () => {
        onlineManager.setOnline(true);
      });
      expect(
        await screen.findByText('Connection: Acme Entra'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the form a failed refresh left, names the failure above it, and heals on Try again', async () => {
      backend.on(CONNECTION, connectionAnswer('Acme Entra'));
      const { user } = await renderPage();
      const form = await screen.findByRole('region', {
        name: 'Connection form',
      });

      backend.on(CONNECTION, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });
      await waitFor(() => expect(backend.count(CONNECTION)).toBe(5));

      const alert = await alertSaying(text('enterpriseSso.refreshFailed'));
      // The same form, edits and all, stays mounted under the notice.
      expect(form).toBeInTheDocument();
      expect(screen.getByText('Connection: Acme Entra')).toBeInTheDocument();

      backend.on(CONNECTION, connectionAnswer('Acme Okta'));
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByText('Connection: Acme Okta'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(text('enterpriseSso.refreshFailed')),
      ).not.toBeInTheDocument();
      expect(form).toBeInTheDocument();
      await waitFor(() => expect(form).toHaveFocus());
    });

    it.each(SHIPPED_LOCALES)(
      'names a failed read and a failed refresh in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(CONNECTION, serviceUnavailable);
        const { container } = await renderPage();
        await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));

        const failed = await alertSaying(text('enterpriseSso.loadFailed'));
        expect(failed).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);

        backend.on(CONNECTION, connectionAnswer('Acme Entra'));
        await act(async () => {
          await client.refetchQueries();
        });
        await screen.findByText('Connection: Acme Entra');
        backend.on(CONNECTION, serviceUnavailable);
        await act(async () => {
          await client.refetchQueries();
        });

        const stale = await alertSaying(text('enterpriseSso.refreshFailed'));
        expect(stale).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);
      },
    );
  },
);

describe(
  'EnterpriseSsoSettings for a role that may not read the settings',
  { timeout: 30_000 },
  () => {
    it('shows a Member the denial and never asks for the connection', async () => {
      viewer.role = 'member';
      backend.on(CONNECTION, connectionAnswer('Acme Entra'));
      await renderPage();

      expect(
        screen.getByText(i18n.t('enterpriseSso', { ns: 'accessDenied' })),
      ).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(backend.count(CONNECTION)).toBe(0);
    });

    it('asks for the connection only once the role is known to read it', async () => {
      viewer.loading = true;
      backend.on(CONNECTION, connectionAnswer('Acme Entra'));
      const { rerender } = await renderPage();

      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(backend.count(CONNECTION)).toBe(0);

      viewer.loading = false;
      rerender(page());

      expect(
        await screen.findByText('Connection: Acme Entra'),
      ).toBeInTheDocument();
      expect(backend.count(CONNECTION)).toBe(1);
    });
  },
);
