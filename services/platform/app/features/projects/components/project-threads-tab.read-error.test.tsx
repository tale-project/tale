import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReturnsOf } from '@/app/lib/backend/contract';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectThreadsTab } from './project-threads-tab';

const { readThreads, queryCalls } = vi.hoisted(() => ({
  readThreads:
    vi.fn<
      () => Promise<ReturnsOf<'chat/project_threads:listThreadsForProject'>>
    >(),
  queryCalls: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args: unknown) => {
    queryCalls(name, args);
    return useQuery({
      queryKey: [name, args],
      queryFn: readThreads,
      retry: false,
    });
  },
}));

vi.mock('../hooks/mutations', () => ({
  useSetThreadSharedWithProject: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

const ownerThread = {
  id: 'thread-1',
  title: 'Existing project chat',
  updatedAt: 1,
  sharedWithProject: false,
  userId: 'user-1',
  authorName: null,
};

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ProjectThreadsTab organizationId="org-1" projectId="proj-1" />
      </QueryClientProvider>,
    ),
  };
}

const noHeadingOrder = { rules: { 'heading-order': { enabled: false } } };

describe('Project Chats list read', () => {
  beforeEach(() => {
    readThreads.mockReset();
    queryCalls.mockClear();
  });

  it('shows a 503 as an accessible error, keeps it during retry, and recovers', async () => {
    const failure = Object.assign(new Error('Service unavailable'), {
      status: 503,
    });
    let resolveRetry:
      | ((
          value: ReturnsOf<'chat/project_threads:listThreadsForProject'>,
        ) => void)
      | undefined;
    readThreads.mockRejectedValueOnce(failure).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );
    const { user, container } = renderTab();

    expect(queryCalls).toHaveBeenCalledWith(
      'chat/project_threads:listThreadsForProject',
      { organizationId: 'org-1', projectId: 'proj-1' },
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this project's chats.");
    expect(
      screen.queryByText("You haven't started any chats in this project yet."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No shared chats yet.')).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your chats' }),
    ).toBeInTheDocument();
    await checkAccessibility(container, noHeadingOrder);

    const retry = within(alert).getByRole('button', { name: 'Try again' });
    await user.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    expect(retry).toHaveFocus();
    expect(screen.getByRole('alert')).toBe(alert);
    expect(screen.queryByText('No shared chats yet.')).not.toBeInTheDocument();
    await user.click(retry);
    expect(readThreads).toHaveBeenCalledTimes(2);

    resolveRetry?.({ mine: [ownerThread], shared: [] });
    expect(
      await screen.findByText('Existing project chat'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'Your chats' })).toHaveFocus();
    });
    expect(screen.getByText('No shared chats yet.')).toBeInTheDocument();
  });

  it('keeps the retry control focused after a second failed attempt', async () => {
    readThreads.mockRejectedValue(new Error('503'));
    const { user } = renderTab();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: 'Try again' });
    await user.click(retry);
    await waitFor(() => expect(readThreads).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveFocus();
    expect(screen.queryByText('No shared chats yet.')).not.toBeInTheDocument();
  });

  it('keeps both normal empty messages after a successful empty read', async () => {
    readThreads.mockResolvedValue({ mine: [], shared: [] });
    renderTab();
    expect(
      await screen.findByText(
        "You haven't started any chats in this project yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No shared chats yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('keeps healthy rows visible and marks them stale when a refresh fails', async () => {
    readThreads
      .mockResolvedValueOnce({
        mine: [ownerThread],
        shared: [
          {
            id: 'thread-2',
            title: 'Shared project chat',
            sharedWithProject: true,
            updatedAt: 2,
            userId: 'user-2',
            authorName: 'Ada',
          },
        ],
      })
      .mockRejectedValueOnce(new Error('503'));
    const { queryClient } = renderTab();
    expect(
      await screen.findByText('Existing project chat'),
    ).toBeInTheDocument();
    expect(screen.getByText('Shared project chat')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await queryClient.refetchQueries();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't refresh this project's chats. What's shown may be out of date.",
    );
    expect(screen.getByText('Existing project chat')).toBeInTheDocument();
    expect(screen.getByText('Shared project chat')).toBeInTheDocument();
  });
});
