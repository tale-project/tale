import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { ProjectOverview } from './project-overview';

// Regression coverage for issue #2648: the header stat line counted
// `stats.threadCount` (`getProjectStats`, every threadMetadata row including
// hidden discussion-backing threads) while the Recent-chats section below
// lists `listProjectThreads` (visible member-facing chats only) — so a fresh
// seeded project showed "1 chat" in the header next to "No chats yet." in the
// list. The fix reads the header count off the same `threads` list; these
// tests pin that the two agree, both on a fresh project (stats disagreeing
// with an empty visible list) and when chats really are present.

type ProjectFixture = {
  name: string;
  description?: string;
  archivedAt?: number;
  canEdit: boolean;
  canAdminister: boolean;
  teamId?: string;
  sharedWithTeamIds?: string[];
};

type ThreadFixture = {
  _id: string;
  threadId: string;
  title?: string;
  updatedAt?: number;
  createdAt: number;
  sharedWithProject?: boolean;
};

let projectFixture: ProjectFixture | null = null;
let statsFixture: {
  fileCount: number;
  threadCount: number;
  truncated: boolean;
} | null = null;
let threadsFixture: ThreadFixture[] = [];

vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: projectFixture, isLoading: false }),
  useProjectStats: () => ({ stats: statsFixture, isLoading: false }),
  useProjectThreads: () => ({ threads: threadsFixture, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectIdentity: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('./project-sharing-section', () => ({
  ProjectSharingSection: () => null,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

const PROJECT_ID = 'proj-1' as Id<'projects'>;

function renderOverview() {
  return render(
    <ProjectOverview organizationId="org-1" projectId={PROJECT_ID} />,
  );
}

describe('ProjectOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFixture = {
      name: 'Getting started',
      canEdit: true,
      canAdminister: true,
    };
    statsFixture = null;
    threadsFixture = [];
  });

  describe('header stat vs recent chats (#2648)', () => {
    it('reads 0 chats in the header when the visible thread list is empty, even if stats.threadCount is stale/non-zero', () => {
      // The seeded project's hidden discussion-backing thread inflates
      // `getProjectStats.threadCount` to 1 while no visible chat exists.
      statsFixture = { fileCount: 0, threadCount: 1, truncated: false };
      threadsFixture = [];

      renderOverview();

      expect(screen.getByText(/0 chats/)).toBeInTheDocument();
      expect(
        screen.getByText('No chats yet. Start one to see it here.'),
      ).toBeInTheDocument();
    });

    it('agrees with the recent-chats list when chats are present', () => {
      statsFixture = { fileCount: 2, threadCount: 0, truncated: false };
      threadsFixture = [
        {
          _id: 't1',
          threadId: 'thread-1',
          title: 'My chat',
          createdAt: 1,
          updatedAt: 2,
        },
      ];

      renderOverview();

      expect(screen.getByText(/1 chat\b/)).toBeInTheDocument();
      expect(screen.getByText('My chat')).toBeInTheDocument();
      expect(
        screen.queryByText('No chats yet. Start one to see it here.'),
      ).not.toBeInTheDocument();
    });
  });
});
