import { ErrorBoundaryBase } from '@tale/ui/error-boundaries/error-boundary-base';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionLapseRecovery } from '@/app/components/session-lapse-recovery';
import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog-lazy';
import { HomeProjects } from '@/app/features/home/components/home-projects';
import { sessionQueryOptions } from '@/app/lib/auth/session-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/tests/utils/render';

import { Route } from './$id';

const chunkAttempts = vi.hoisted(() => ({
  project: vi.fn(),
  embedding: vi.fn(),
  preview: vi.fn(),
}));

// Empty project list: virtual-row geometry is outside chunk containment.
vi.mock('@/app/features/home/components/home-stream', () => ({
  HomeWindowedList: () => null,
}));

vi.mock('@/app/features/chat/components/thread-dnd', () => ({
  useProjectDropZone: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));
vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useProjectPin: () => ({ setPinned: vi.fn() }),
}));
vi.mock(
  '@/app/features/projects/components/project-create-dialog',
  async () => {
    chunkAttempts.project();
    throw new Error('project chunk rejected');
  },
);

// Reject the actual dynamic imports, rather than replacing lazy/Suspense or
// throwing from an already loaded component. The local boundaries must catch
// the rejected chunk before the dashboard's outer boundary loses the page.
vi.mock(
  '@/app/features/settings/data-residency/components/embedding-setup-alert',
  async () => {
    chunkAttempts.embedding();
    throw new Error('embedding chunk rejected');
  },
);
vi.mock(
  '@/app/features/documents/components/document-preview-dialog',
  async () => {
    chunkAttempts.preview();
    throw new Error('preview chunk rejected');
  },
);

/** What the shell reads: the page it is on, and what each nudge's read
 * says. None of the nudges shows until a case says so. */
const h = vi.hoisted(() => ({
  pathname: '/dashboard/org-1/documents',
  twoFactor: undefined as unknown,
  embeddingConfigured: true,
  previewOpen: false,
  showProjects: false,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
  }),
  Outlet: () => (
    <>
      <h2>Page</h2>
      {h.showProjects && (
        <HomeProjects organizationId="org-1" projects={[]} loading={false} />
      )}
      {h.previewOpen && (
        <DocumentPreviewDialog
          open
          onOpenChange={() => undefined}
          documentId="doc-1"
        />
      )}
    </>
  ),
  // The nudges' links lead to settings; no router is needed to lay them out.
  Link: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <a href="#settings" className={className}>
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: h.pathname, search: {} }),
  useNavigate: () => () => Promise.resolve(),
  useBlocker: () => ({
    status: 'idle',
    proceed: () => undefined,
    reset: () => undefined,
  }),
}));

// An admin of org-1, signed in, whose membership has resolved.
const MEMBER_CONTEXT = {
  data: {
    status: 'ok',
    role: 'admin',
    userId: 'user-1',
    organizationId: 'org-1',
  },
  isLoading: false,
  isError: false,
  refetch: () => Promise.resolve(),
};
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => MEMBER_CONTEXT,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null, error: null }),
    organization: { setActive: () => Promise.resolve() },
  },
}));
vi.mock('@/app/lib/backend/use-backend-hints', () => ({
  useBackendHints: () => undefined,
}));
vi.mock('@/app/features/auth/hooks/use-password-expiry-gate', () => ({
  usePasswordExpiryGate: () => undefined,
}));

// The shell's reading regions are out of scope: the notch rule is about the
// alert stack and the header above them.
vi.mock('@/app/components/layout/app-sidebar/app-sidebar', () => ({
  AppSidebar: () => null,
}));
vi.mock('@/app/components/layout/mobile-bottom-nav', () => ({
  MobileBottomNav: () => null,
}));
vi.mock('@/app/components/user-button', () => ({
  UserButton: () => <button type="button">Account</button>,
}));
vi.mock('@/app/features/changelog/components/changelog-toast-trigger', () => ({
  ChangelogToastTrigger: () => null,
}));
vi.mock('@/app/features/home/components/home-panel', () => ({
  HomePanel: () => null,
}));

// The real nudges, each shown the way its own read says so.
vi.mock('@/app/context/account-bootstrap-context', () => ({
  useTwoFactorStatus: () => h.twoFactor,
}));
vi.mock('@/app/features/settings/data-residency/hooks/queries', () => ({
  useOrgKnowledgeEmbedding: () => ({
    data: { configured: h.embeddingConfigured },
    isError: false,
  }),
}));
vi.mock('@/app/features/settings/providers/hooks/queries', () => ({
  useProviderCredentials: () => ({ data: [{ id: 'credential-1' }] }),
}));

const DashboardLayout = (Route as unknown as { component: () => ReactNode })
  .component;

afterEach(() => {
  cleanup();
  h.embeddingConfigured = true;
  h.previewOpen = false;
  h.showProjects = false;
});

async function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(sessionQueryOptions.queryKey, {
    data: {
      user: { id: 'user-1' },
      session: { activeOrganizationId: 'org-1' },
    },
    error: null,
  });
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <SessionLapseRecovery
          recovery={{
            isLapsed: false,
            open: false,
            checking: false,
            checkFailed: false,
            liveSessionVersion: 0,
            setOpen: vi.fn(),
            continueToLogIn: vi.fn(),
          }}
        >
          <ErrorBoundaryBase fallback={() => <h2>Dashboard failed</h2>}>
            <DashboardLayout />
          </ErrorBoundaryBase>
        </SessionLapseRecovery>
      </QueryClientProvider>,
    );
  });
}

describe('dashboard lazy chunk failures', () => {
  it('closes a rejected New project dialog and keeps Home and the dashboard page rendered', async () => {
    h.showProjects = true;
    await renderShell();
    const opener = screen.getByRole('button', { name: 'New project' });
    await act(async () => {
      fireEvent.click(opener);
    });
    await waitFor(() => {
      expect(chunkAttempts.project).toHaveBeenCalled();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New project' })).toBe(opener);
      expect(screen.getByRole('main')).toContainElement(
        screen.getByRole('heading', { name: 'Page' }),
      );
      expect(screen.queryByText('Dashboard failed')).not.toBeInTheDocument();
    });
  });

  it('omits a rejected embedding alert and keeps the dashboard page rendered', async () => {
    h.embeddingConfigured = false;
    await renderShell();
    expect(chunkAttempts.embedding).toHaveBeenCalled();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Page' }),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Knowledge search is off'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard failed')).not.toBeInTheDocument();
  });

  it('shows the document dialog fallback for a rejected chunk and keeps the dashboard page rendered', async () => {
    h.previewOpen = true;
    await renderShell();
    expect(chunkAttempts.preview).toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Page' }),
    );
    expect(screen.queryByText('Dashboard failed')).not.toBeInTheDocument();
  });
});
