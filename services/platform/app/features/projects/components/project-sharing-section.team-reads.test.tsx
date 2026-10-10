import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { forgetSavedLocale } from '@/tests/utils/lapsed-session';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { ProjectSharingSection } from './project-sharing-section';

const { updateSharing } = vi.hoisted(() => ({ updateSharing: vi.fn() }));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-audit',
}));
vi.mock('../hooks/mutations', () => ({
  useUpdateProjectSharing: () => ({
    mutateAsync: updateSharing,
    isPending: false,
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/teams">{children}</a>
  ),
}));

const team = { id: 'a', name: 'Alpha', memberCount: 1, createdAt: 0 };
const clients: QueryClient[] = [];
type Answer = () => Promise<unknown>;
const failed = () => Promise.reject(new BackendApiError(503, 'Controlled'));
const answered = () => Promise.resolve({ teams: [team] });
/** A member outside the audience team: their own teams name none of it. */
const notMine = () => Promise.resolve({ teams: [] });
const held = () => {
  let release: () => void = () => {};
  const answer: Answer = () =>
    new Promise((resolve) => {
      release = () => resolve({ teams: [team] });
    });
  return { answer, release: () => release() };
};

/** The two team reads the Audience row makes: the assignable list
 * (`GET /teams`) and the directory that names every team. */
function serve(reads: { teams: Answer; directory: Answer }) {
  const counts = { teams: 0, directory: 0 };
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path === '/teams/directory') {
      counts.directory += 1;
      return reads.directory();
    }
    if (path === '/teams') {
      counts.teams += 1;
      return reads.teams();
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  return counts;
}

function mount({ canAdminister = true, teamIds = ['a'] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ProjectSharingSection
        projectId="project-audit"
        organizationId="org-audit"
        teamIds={teamIds}
        canAdminister={canAdminister}
      />
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.clearAllMocks();
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
  await forgetSavedLocale();
});

describe('Audience team reads', { timeout: 30_000 }, () => {
  it('counts the saved teams while their names load, never calling one unknown', async () => {
    const directory = held();
    const teams = held();
    serve({ teams: teams.answer, directory: directory.answer });
    mount();
    expect(await screen.findByText('1 team')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Unknown team')).not.toBeInTheDocument();
    expect(screen.queryByText('No teams yet.')).not.toBeInTheDocument();
    await act(async () => directory.release());
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    await act(async () => teams.release());
    expect(
      await screen.findByRole('combobox', { name: 'Audience' }),
    ).toBeInTheDocument();
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it('keeps the audience countable and offers Try again when both team reads fail', async () => {
    const counts = serve({ teams: failed, directory: failed });
    const { container } = mount({ teamIds: ['a', 'b'] });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load teams.",
    );
    expect(screen.getByText('2 teams')).toBeInTheDocument();
    expect(screen.queryByText(/Unknown team/)).not.toBeInTheDocument();
    expect(screen.queryByText('No teams yet.')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(counts.teams).toBe(4);
    await checkAccessibility(container);
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it('treats a refused teams read as unavailable, not as an organization without teams', async () => {
    serve({
      teams: () =>
        Promise.reject(new BackendApiError(403, 'Refused', 'ROLE_FORBIDDEN')),
      directory: answered,
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load teams.",
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('No teams yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('Create a team')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('names the audience from the assignable list when only the directory fails', async () => {
    serve({ teams: answered, directory: failed });
    mount();
    expect(
      await screen.findByRole('combobox', { name: 'Audience' }),
    ).toHaveTextContent('Alpha');
    expect(screen.queryByText(/Unknown team/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still calls a team the answered directory lacks unknown', async () => {
    serve({ teams: failed, directory: answered });
    mount({ teamIds: ['gone'] });
    await screen.findByRole('alert');
    expect(screen.getByText('Unknown team')).toBeInTheDocument();
  });

  it("names a member's failed directory read, retries it and returns focus to the audience", async () => {
    const counts = serve({ teams: notMine, directory: failed });
    const { user, container } = mount({ canAdminister: false });
    const group = await screen.findByRole('group', {
      name: 'Effective audience',
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load team names.",
    );
    expect(group).toHaveTextContent('1 team');
    expect(screen.queryByText('Unknown team')).not.toBeInTheDocument();
    expect(counts.directory).toBe(4);
    await checkAccessibility(container);

    const next = held();
    serve({ teams: notMine, directory: next.answer });
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    await act(async () => next.release());
    await waitFor(() => expect(group).toHaveTextContent('Alpha'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(group).toHaveFocus());
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it('shows a member a loading status, not an unknown team, while names load', async () => {
    const directory = held();
    serve({ teams: notMine, directory: directory.answer });
    mount({ canAdminister: false });
    const group = await screen.findByRole('group', {
      name: 'Effective audience',
    });
    expect(group).toHaveTextContent('1 team');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Unknown team')).not.toBeInTheDocument();
    await act(async () => directory.release());
    await waitFor(() => expect(group).toHaveTextContent('Alpha'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    { locale: 'en', message: "Couldn't load team names.", count: '1 team' },
    {
      locale: 'de',
      message: 'Teamnamen konnten nicht geladen werden.',
      count: '1 Team',
    },
    {
      locale: 'fr',
      message: 'Impossible de charger les noms des équipes.',
      count: '1 équipe',
    },
    {
      locale: 'de-CH',
      message: 'Teamnamen konnten nicht geladen werden.',
      count: '1 Team',
    },
  ])(
    "renders a member's failed names read in $locale",
    async ({ locale, message, count }) => {
      localStorage.setItem('user-locale', locale);
      await i18n.changeLanguage(locale);
      serve({ teams: notMine, directory: failed });
      mount({ canAdminister: false });
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByText(count)).toBeInTheDocument();
    },
  );
});
