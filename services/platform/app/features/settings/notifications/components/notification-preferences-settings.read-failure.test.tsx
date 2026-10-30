import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from '@tanstack/react-query';
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

import { NotificationPreferencesSettings } from './notification-preferences-settings';

/**
 * Settings › Notifications over its real read: `useNotificationPreferences`,
 * the adapter row, `backendFetch` and the read retry policy (four attempts
 * for a fault) against a closed synthetic transport. A switch states what
 * the person chose, so none is shown before the read has answered — never
 * every switch on because nothing was read (#4653).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', async () => {
  const { defineAbilityFor } = await import('@/lib/permissions/ability');
  return { useAbility: () => defineAbilityFor('member') };
});

const PREFERENCES = /^GET \/api\/app\/collab\/preferences\?orgId=org-1$/;

/** The stored row: a key it leaves out is on (the switch's default). */
function preferencesAnswer(prefs: Record<string, boolean>) {
  return () => Response.json(prefs);
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/notifications',
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

async function renderPage() {
  const view = render(
    <QueryClientProvider client={client}>
      <NotificationPreferencesSettings />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

const text = (key: string) => i18n.t(key, { ns: 'notificationPreferences' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });

/** The section the switches live in — where a Try again that gave way
 * hands its focus. */
function preferencesSection(): HTMLElement {
  return screen.getByRole('region', { name: text('title') });
}

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe(
  'NotificationPreferencesSettings when its read fails',
  { timeout: 30_000 },
  () => {
    it('shows no switch, names the failure with Try again, and recovers from the keyboard', async () => {
      backend.on(PREFERENCES, serviceUnavailable);
      const { user } = await renderPage();

      await waitFor(() => expect(backend.count(PREFERENCES)).toBe(4));
      // Nothing was read, so no switch claims a choice, on or off.
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      const alert = await alertSaying(text('loadFailed'));
      expect(preferencesSection()).toContainElement(alert);

      backend.on(PREFERENCES, preferencesAnswer({ mention: false }));
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');

      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: text('fields.mention.label') }),
        ).not.toBeChecked(),
      );
      expect(
        screen.getByRole('switch', { name: text('fields.taskAssigned.label') }),
      ).toBeChecked();
      expect(screen.queryByText(text('loadFailed'))).not.toBeInTheDocument();
      expect(backend.count(PREFERENCES)).toBe(5);
      // Try again gave way to the switches: its focus is on their section,
      // not lost to the page.
      await waitFor(() => expect(preferencesSection()).toHaveFocus());
    });

    it('keeps the failure and the focus on Try again while a retry fails again', async () => {
      backend.on(PREFERENCES, serviceUnavailable);
      const { user } = await renderPage();
      const alert = await alertSaying(text('loadFailed'));

      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(backend.count(PREFERENCES)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(screen.getByText(text('loadFailed'))).toBeInTheDocument();
      expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
      expect(retry).toHaveFocus();
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('masks every switch while the first read waits, offline included', async () => {
      // Offline, react-query pauses the read before it starts: it is
      // neither loading nor failed, and nothing has answered.
      onlineManager.setOnline(false);
      backend.on(PREFERENCES, preferencesAnswer({ mention: false }));
      await renderPage();

      expect(backend.count(PREFERENCES)).toBe(0);
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await act(async () => {
        onlineManager.setOnline(true);
      });
      await waitFor(() =>
        expect(
          screen.getByRole('switch', { name: text('fields.mention.label') }),
        ).not.toBeChecked(),
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps the switches a failed refresh left, names the failure above them, and heals on Try again', async () => {
      backend.on(PREFERENCES, preferencesAnswer({ mention: false }));
      const { user } = await renderPage();
      const mentions = await screen.findByRole('switch', {
        name: text('fields.mention.label'),
      });
      expect(mentions).not.toBeChecked();

      backend.on(PREFERENCES, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });
      await waitFor(() => expect(backend.count(PREFERENCES)).toBe(5));

      const alert = await alertSaying(text('refreshFailed'));
      expect(preferencesSection()).toContainElement(alert);
      // The last answer stays on screen, the failure named above it.
      expect(mentions).toBeInTheDocument();
      expect(mentions).not.toBeChecked();

      backend.on(PREFERENCES, preferencesAnswer({ mention: true }));
      const retry = within(alert).getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');

      await waitFor(() => expect(mentions).toBeChecked());
      expect(screen.queryByText(text('refreshFailed'))).not.toBeInTheDocument();
      await waitFor(() => expect(preferencesSection()).toHaveFocus());
    });

    it.each(SHIPPED_LOCALES)(
      'names a failed read and a failed refresh in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(PREFERENCES, serviceUnavailable);
        const { container } = await renderPage();
        await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));

        const failed = await alertSaying(text('loadFailed'));
        expect(failed).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);

        backend.on(PREFERENCES, preferencesAnswer({}));
        await act(async () => {
          await client.refetchQueries();
        });
        await waitFor(() =>
          expect(screen.getAllByRole('switch').length).toBeGreaterThan(0),
        );
        backend.on(PREFERENCES, serviceUnavailable);
        await act(async () => {
          await client.refetchQueries();
        });

        const stale = await alertSaying(text('refreshFailed'));
        expect(stale).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);
      },
    );
  },
);
