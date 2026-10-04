import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
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

import { TeamsSection } from './teams-section';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #3846 / #3847: a membership read that failed read as "You are not in any
// team yet", with no way to try again — on the one page that tells a member
// which documents, projects and inbox queues their teams open. The read runs
// for real here (hook, `myTeamsQuery`, `backendFetch`, the four-attempt retry
// policy) against a closed synthetic transport.

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => false }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/teams">{children}</a>
  ),
}));

const MINE = /^GET \/api\/app\/teams\/mine\?orgId=org-1$/;
const ENGINEERING = {
  id: 't-1',
  name: 'Engineering',
  memberCount: 4,
  createdAt: 0,
};
const DESIGN = { id: 't-2', name: 'Design', memberCount: 2, createdAt: 0 };

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <TeamsSection />
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'settings' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const section = () =>
  screen.getByRole('region', { name: t('account.teams.title') });

describe(
  'TeamsSection when the membership read fails',
  { timeout: 30_000 },
  () => {
    it('says the teams could not load, never that you are in none', async () => {
      backend.on(MINE, () => serviceUnavailable());
      renderSection();

      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('account.teams.loadFailed'));
      expect(backend.count(MINE)).toBe(4);
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      expect(
        within(section()).queryByText(t('account.teams.none')),
      ).not.toBeInTheDocument();
    });

    it('keeps Try again, and the focus on it, while it runs and when it fails again', async () => {
      backend.on(MINE, () => serviceUnavailable());
      const { user } = renderSection();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        MINE,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(retry);

      // react-query resets a read that never answered to `pending` as the
      // retry starts; the notice holds still, its button busy and focused.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(
        within(section()).queryByText(t('account.teams.none')),
      ).not.toBeInTheDocument();

      backend.on(MINE, () => serviceUnavailable());
      answer(serviceUnavailable());
      await waitFor(() => expect(backend.count(MINE)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
      expect(
        within(section()).queryByText(t('account.teams.none')),
      ).not.toBeInTheDocument();
    });

    it('lists the teams when Try again works, and hands the focus to the section', async () => {
      backend.on(MINE, () => serviceUnavailable());
      const { user } = renderSection();
      const alert = await within(section()).findByRole('alert');

      backend.on(MINE, () => Response.json({ teams: [ENGINEERING, DESIGN] }));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));

      expect(
        await within(section()).findByText('Engineering'),
      ).toBeInTheDocument();
      expect(within(section()).getByText('Design')).toBeInTheDocument();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      // The Try again that held the focus is gone: the focus is on the
      // section, which keeps its name, not on the page.
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('keeps "not in any team" for a read that answered with no teams', async () => {
      backend.on(MINE, () => Response.json({ teams: [] }));
      renderSection();

      expect(
        await within(section()).findByText(t('account.teams.none')),
      ).toBeInTheDocument();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      expect(
        within(section()).queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(backend.count(MINE)).toBe(1);
    });

    it('keeps the teams through a failed refresh and says they may be out of date', async () => {
      backend.on(MINE, () => Response.json({ teams: [ENGINEERING, DESIGN] }));
      const { user } = renderSection();
      await within(section()).findByText('Design');

      backend.on(MINE, () => serviceUnavailable());
      void client.invalidateQueries();
      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('account.teams.refreshFailed'));
      expect(within(section()).getByText('Engineering')).toBeVisible();
      expect(within(section()).getByText('Design')).toBeVisible();

      // Meanwhile an admin took the member out of Design.
      backend.on(MINE, () => Response.json({ teams: [ENGINEERING] }));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() =>
        expect(within(section()).queryByText('Design')).not.toBeInTheDocument(),
      );
      expect(within(section()).getByText('Engineering')).toBeVisible();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      await waitFor(() => expect(section()).toHaveFocus());
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed read and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(MINE, () => serviceUnavailable());
        renderSection();

        const alert = await within(section()).findByRole('alert');
        expect(alert).toHaveTextContent(t('account.teams.loadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        for (const key of [
          'account.teams.loadFailed',
          'account.teams.refreshFailed',
        ]) {
          expect(t(key)).not.toBe(key);
          // A translation of its own, not the English fallback.
          if (locale !== 'en') {
            expect(t(key)).not.toBe(i18n.t(key, { ns: 'settings', lng: 'en' }));
          }
        }
      });
    });
  },
);
