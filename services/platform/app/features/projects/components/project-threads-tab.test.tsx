import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ProjectThreadsTab } from './project-threads-tab';

// The owner toggling "Share with project" on a personalized chat must be told,
// for that specific action, that personalization was just turned off — the
// backend returns `autoDisabledPersonalization` precisely so the UI can say so
// (issue #2071). These tests pin that the success toast carries the disclosure
// only on the auto-disable transition, and not on a plain share / unshare.

const mockSetMutateAsync = vi.fn();
const mockToast = vi.fn();

type ThreadFixture = {
  _id: string;
  threadId: string;
  title?: string;
  sharedWithProject?: boolean;
  userId: string;
};

let yoursFixture: ThreadFixture[] = [];
let sharedFixture: ThreadFixture[] = [];

vi.mock('../hooks/queries', () => ({
  useProjectThreadSegments: () => ({
    yours: yoursFixture,
    shared: sharedFixture,
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetThreadSharedWithProject: () => ({
    mutateAsync: mockSetMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-1' } }),
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

const PROJECT_ID = 'proj-1' as Id<'projects'>;

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
    yoursFixture = [];
    sharedFixture = [];
  });

  describe('rendering', () => {
    it('lists the owner chats with a share toggle and the empty shared state', async () => {
      yoursFixture = [
        {
          _id: 't1',
          threadId: 'thread-1',
          title: 'My chat',
          sharedWithProject: false,
          userId: 'user-1',
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
  });

  describe('share toggle disclosure', () => {
    it('discloses that personalization was disabled on the auto-disable transition', async () => {
      mockSetMutateAsync.mockResolvedValue({
        autoDisabledPersonalization: true,
      });
      yoursFixture = [
        {
          _id: 't1',
          threadId: 'thread-1',
          title: 'My chat',
          sharedWithProject: false,
          userId: 'user-1',
        },
      ];
      const { user } = renderTab();

      await user.click(
        screen.getByRole('switch', { name: 'Share with project' }),
      );

      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledWith({
          threadId: 'thread-1',
          shared: true,
        });
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Chat shared with project',
          description:
            'Personalization was turned off for this chat, so your memories and instructions stay private from other members.',
          variant: 'success',
        }),
      );
    });

    it('shows no personalization disclosure when sharing a chat that was already non-personalized', async () => {
      mockSetMutateAsync.mockResolvedValue({
        autoDisabledPersonalization: false,
      });
      yoursFixture = [
        {
          _id: 't1',
          threadId: 'thread-1',
          title: 'My chat',
          sharedWithProject: false,
          userId: 'user-1',
        },
      ];
      const { user } = renderTab();

      await user.click(
        screen.getByRole('switch', { name: 'Share with project' }),
      );

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Chat shared with project',
            description: undefined,
            variant: 'success',
          }),
        );
      });
    });

    it('shows the plain unshare toast with no disclosure when hiding a chat', async () => {
      mockSetMutateAsync.mockResolvedValue({
        autoDisabledPersonalization: false,
      });
      yoursFixture = [
        {
          _id: 't1',
          threadId: 'thread-1',
          title: 'My chat',
          sharedWithProject: true,
          userId: 'user-1',
        },
      ];
      const { user } = renderTab();

      await user.click(
        screen.getByRole('switch', { name: 'Share with project' }),
      );

      await waitFor(() => {
        expect(mockSetMutateAsync).toHaveBeenCalledWith({
          threadId: 'thread-1',
          shared: false,
        });
      });
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Chat hidden from project',
          description: undefined,
          variant: 'success',
        }),
      );
    });
  });
});
