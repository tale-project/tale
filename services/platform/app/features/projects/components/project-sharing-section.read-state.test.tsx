import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
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

function mount(teamIds = ['a']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectSharingSection
          projectId="project-audit"
          organizationId="org-audit"
          teamIds={teamIds}
          canAdminister
        />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.clearAllMocks();
});

it('preserves known audience after four failed reads and recovers through Try again', async () => {
  let teamReads = 0;
  let recover = false;
  let releaseRetry: (() => void) | undefined;
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path === '/teams/directory') return { teams: [team] };
    if (path !== '/teams') throw new Error(`Unexpected path: ${path}`);
    teamReads += 1;
    if (!recover) throw new BackendApiError(503, 'Controlled failure');
    await new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    return { teams: [team] };
  });
  const { client, user } = mount();
  await waitFor(() => {
    const query = client
      .getQueryCache()
      .find({ queryKey: ['backend', 'org-audit', 'team', 'org-list'] });
    expect(query?.state.status).toBe('error');
    expect(query?.state.fetchStatus).toBe('idle');
    expect(query?.state.fetchFailureCount).toBe(4);
  });
  expect(teamReads).toBe(4);
  expect(screen.queryByText(/No teams yet/)).not.toBeInTheDocument();
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't load teams.",
  );
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  recover = true;
  const retry = screen.getByRole('button', { name: 'Try again' });
  await user.click(retry);
  expect(retry).toHaveFocus();
  await waitFor(() => expect(releaseRetry).toBeTypeOf('function'));
  expect(retry).toHaveAttribute('aria-busy', 'true');
  expect(retry).toHaveAttribute('aria-disabled', 'true');
  expect(retry).toHaveFocus();
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  await act(async () => releaseRetry?.());
  const audiencePicker = await screen.findByRole('combobox', {
    name: 'Audience',
  });
  expect(audiencePicker).toBeInTheDocument();
  await waitFor(() => expect(audiencePicker).toHaveFocus());
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(teamReads).toBe(5);
  expect(updateSharing).not.toHaveBeenCalled();
});

it('shows creation only after a successful empty teams read', async () => {
  vi.mocked(backendFetch).mockResolvedValue({ teams: [] });
  mount([]);
  expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Try again' }),
  ).not.toBeInTheDocument();
});

it.each([
  { teamIds: [], audience: 'Org-wide' },
  { teamIds: ['unresolved-team'], audience: 'Unknown team' },
])(
  'retains $audience and allows another retry after repeated failure',
  async ({ teamIds, audience }) => {
    let reads = 0;
    vi.mocked(backendFetch).mockImplementation(async (path) => {
      if (path === '/teams/directory') return { teams: [team] };
      reads += 1;
      throw new BackendApiError(503, 'Controlled failure');
    });
    const { user } = mount(teamIds);
    await screen.findByRole('alert');
    expect(screen.getByText(audience)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    await screen.findByRole('alert');
    expect(retry).toHaveFocus();
    expect(reads).toBe(8);
    expect(screen.getByText(audience)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.queryByText(/No teams yet/)).not.toBeInTheDocument();
    expect(updateSharing).not.toHaveBeenCalled();
  },
);

it('keeps known audience but blocks stale picker options after a background failure', async () => {
  let fail = false;
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path === '/teams' && fail)
      throw new BackendApiError(503, 'Controlled failure');
    return { teams: [team] };
  });
  const { client } = mount();
  await screen.findByRole('combobox', { name: 'Audience' });
  fail = true;
  await act(async () => {
    await client.refetchQueries();
  });
  expect(screen.getByText('Alpha')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    "Couldn't load teams.",
  );
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(updateSharing).not.toHaveBeenCalled();
});
