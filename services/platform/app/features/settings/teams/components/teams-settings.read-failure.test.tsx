import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

import { TeamsSettings } from './teams-settings';

/**
 * Settings › Teams over its real read: `useOrgTeams`, the adapter row,
 * `backendFetch` and the read retry policy (four attempts for a fault)
 * against a closed synthetic transport. A read that failed is the table's
 * error state with **Try again**, never a skeleton that never ends, and a
 * failed refresh is named above the rows it left (#4653).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

// The name column alone: the production config's select column leaves an
// empty `<th>` in the table's loading state (see `teams-table.test.tsx`),
// which is not this read's to judge.
vi.mock('../hooks/use-teams-table-config', () => ({
  useTeamsTableConfig: () => ({
    columns: [{ accessorKey: 'name', header: 'Name' }],
    searchPlaceholder: 'Search teams',
    stickyLayout: false,
    pageSize: 20,
  }),
}));

const TEAMS = /^GET \/api\/app\/teams\?orgId=org-1$/;
const TEAM_MEMBERS = /^GET \/api\/app\/teams\/[^/?]+\/members/;

function teamsAnswer(...names: string[]) {
  return () =>
    Response.json({
      teams: names.map((name, index) => ({
        id: name.toLowerCase(),
        name,
        memberCount: 2,
        createdAt: index + 1,
      })),
    });
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/settings/teams');
  backend = syntheticBackend();
  // The preloader subscribes to every listed team's members.
  backend.on(TEAM_MEMBERS, () => Response.json({ members: [] }));
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
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

async function renderPage() {
  const view = render(
    <QueryClientProvider client={client}>
      <TeamsSettings organizationId="org-1" />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

/** The section the page lists its teams in — where a Try again that gave
 * way hands its focus. */
function teamsSection(): HTMLElement {
  return screen.getByRole('region', {
    name: i18n.t('teams', { ns: 'navigation' }),
  });
}

/** The table's error state's retry, once the read's policy has given up. */
async function tableRetry(): Promise<HTMLElement> {
  return screen.findByRole('button', {
    name: i18n.t('errors.tryAgain', { ns: 'common' }),
  });
}

const refreshFailed = () => i18n.t('teams.refreshFailed', { ns: 'settings' });

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

describe('TeamsSettings when its teams read fails', { timeout: 30_000 }, () => {
  it('shows the table’s error state with Try again instead of an endless skeleton, and recovers from the keyboard', async () => {
    backend.on(TEAMS, serviceUnavailable);
    const { user } = await renderPage();

    await waitFor(() => expect(backend.count(TEAMS)).toBe(4));
    // No table is left loading under the failure: no skeleton rows, no
    // empty state, no rows.
    await waitFor(() =>
      expect(screen.queryByRole('table')).not.toBeInTheDocument(),
    );
    const retry = await tableRetry();
    expect(backend.count(TEAMS)).toBe(4);

    backend.on(TEAMS, teamsAnswer('Finance'));
    retry.focus();
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('cell', { name: 'Finance' }),
    ).toBeInTheDocument();
    expect(backend.count(TEAMS)).toBe(5);
    // Try again gave way to the rows: its focus is on the teams' section,
    // not lost to the page.
    await waitFor(() => expect(teamsSection()).toHaveFocus());
  });

  it('keeps the error state, and the focus on the list, while a retry fails again', async () => {
    backend.on(TEAMS, serviceUnavailable);
    const { user } = await renderPage();
    const retry = await tableRetry();

    retry.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(backend.count(TEAMS)).toBe(8));

    expect(await tableRetry()).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await waitFor(() => expect(teamsSection()).toHaveFocus());
  });

  it('keeps the rows a failed refresh left, names the failure above them, and heals on Try again', async () => {
    backend.on(TEAMS, teamsAnswer('Finance'));
    const { user } = await renderPage();
    expect(
      await screen.findByRole('cell', { name: 'Finance' }),
    ).toBeInTheDocument();

    backend.on(TEAMS, serviceUnavailable);
    await act(async () => {
      await client.refetchQueries();
    });
    await waitFor(() => expect(backend.count(TEAMS)).toBe(5));

    const alert = await alertSaying(refreshFailed());
    expect(screen.getByRole('cell', { name: 'Finance' })).toBeInTheDocument();
    expect(teamsSection()).toContainElement(alert);

    backend.on(TEAMS, teamsAnswer('Finance', 'Legal'));
    const retry = within(alert).getByRole('button', {
      name: i18n.t('actions.tryAgain', { ns: 'common' }),
    });
    retry.focus();
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('cell', { name: 'Legal' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(refreshFailed())).not.toBeInTheDocument();
    await waitFor(() => expect(teamsSection()).toHaveFocus());
  });

  it.each(SHIPPED_LOCALES)(
    'names a failed read and a failed refresh in %s and passes axe',
    async (locale) => {
      saveLocale(locale);
      backend.on(TEAMS, serviceUnavailable);
      const { container } = await renderPage();
      await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));

      await tableRetry();
      await checkAccessibility(container);

      backend.on(TEAMS, teamsAnswer('Finance'));
      await act(async () => {
        await client.refetchQueries();
      });
      await screen.findByRole('cell', { name: 'Finance' });
      backend.on(TEAMS, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });

      await alertSaying(refreshFailed());
      await checkAccessibility(container);
    },
  );
});
