import { describe, it, expect, vi, beforeEach } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ProjectThreadsTab } from './project-threads-tab';

// The tab lists the caller's own project conversations (each with the
// "Share with project" switch) and, below, the ones other members shared —
// from the chat-v2 tables. These pin the two segments, the toggle's wire
// shape, and the author-name fallback.

const mockSetMutateAsync = vi.fn();
const mockToast = vi.fn();

type ThreadFixture = {
  id: string;
  title?: string;
  updatedAt: number;
  sharedWithProject?: boolean;
  userId: string;
  authorName: string | null;
};

let mineFixture: ThreadFixture[] = [];
let sharedFixture: ThreadFixture[] = [];

vi.mock('../hooks/queries', () => ({
  useProjectChatThreads: () => ({
    mine: mineFixture,
    shared: sharedFixture,
    isLoading: false,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetThreadSharedWithProject: () => ({
    mutateAsync: mockSetMutateAsync,
    isPending: false,
  }),
}));

// The component imports the standalone `toast` fn directly; stub it so the
// success/error toasts don't reach the real toast store.
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

// `<Link>` / `useNavigate` need a RouterProvider that this isolated render has
// no access to; stub the router like the other projects component tests do.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

const PROJECT_ID = 'proj-1' as string;

function renderTab() {
  return render(
    <ProjectThreadsTab organizationId="org-1" projectId={PROJECT_ID} />,
  );
}

// The static page chrome stacks the StickySectionHeader (h2) above the
// PageSection (h2/h3) without an h1 in isolation; that heading-order jump is a
// standalone-render artifact — the tab sits under the page's h1 in the app.
const NO_HEADING_ORDER = { rules: { 'heading-order': { enabled: false } } };

describe('ProjectThreadsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mineFixture = [];
    sharedFixture = [];
  });

  it('lists the owner chats with a share toggle and the empty shared state', async () => {
    mineFixture = [
      {
        id: 'thread-1',
        title: 'My chat',
        updatedAt: 1,
        sharedWithProject: false,
        userId: 'user-1',
        authorName: null,
      },
    ];
    const { container } = renderTab();

    expect(
      screen.getByRole('heading', { name: 'Your chats' }),
    ).toBeInTheDocument();
    expect(screen.getByText('My chat')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Share with project' }),
    ).toBeInTheDocument();
    expect(screen.getByText('No shared chats yet.')).toBeInTheDocument();

    await checkAccessibility(container, NO_HEADING_ORDER);
  });

  it("shows the author's resolved name for shared chats, falling back to a userId fragment", () => {
    sharedFixture = [
      {
        id: 'thread-shared-1',
        title: 'Named author chat',
        updatedAt: 2,
        sharedWithProject: true,
        userId: 'user-2',
        authorName: 'Ada Lovelace',
      },
      {
        id: 'thread-shared-2',
        title: 'Unresolved author chat',
        updatedAt: 1,
        sharedWithProject: true,
        userId: 'abcdef1234567890',
        authorName: null,
      },
    ];
    renderTab();

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });

  it('shares and unshares through the owner-gated chat mutation', async () => {
    mockSetMutateAsync.mockResolvedValue(true);
    mineFixture = [
      {
        id: 'thread-1',
        title: 'My chat',
        updatedAt: 1,
        sharedWithProject: false,
        userId: 'user-1',
        authorName: null,
      },
    ];
    const { user } = renderTab();

    await user.click(
      screen.getByRole('switch', { name: 'Share with project' }),
    );

    await waitFor(() => {
      expect(mockSetMutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        threadId: 'thread-1',
        shared: true,
      });
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Chat shared with project',
        variant: 'success',
      }),
    );
  });
});
