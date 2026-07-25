import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { ProjectOverview } from './project-overview';

// Regression coverage for issue #2648: the header stat line counted
// `stats.threadCount` (`getProjectStats`, every threadMetadata row including
// hidden backing threads) rather than the visible member-facing chats
// (`listProjectThreads`) — so a fresh seeded project claimed "1 chat" when a
// member could see none. The header count reads off the visible `threads`
// list; these tests pin that, both when stats disagree with an empty visible
// list and when chats really are present.

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
  // The instructions section is part of this page now, so its write is
  // reachable from here too.
  useUpdateProjectInstructions: () => ({
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

  describe('header chat count (#2648)', () => {
    it('reads 0 chats in the header when the visible thread list is empty, even if stats.threadCount is stale/non-zero', () => {
      // A hidden backing thread inflates `getProjectStats.threadCount` to 1
      // while no visible chat exists.
      statsFixture = { fileCount: 0, threadCount: 1, truncated: false };
      threadsFixture = [];

      renderOverview();

      expect(screen.getByText(/0 chats/)).toBeInTheDocument();
    });

    it('counts the visible chats when chats are present', () => {
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
      expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    });

    it('never shows the retired Get-started nudge, even on an empty project', () => {
      statsFixture = { fileCount: 0, threadCount: 0, truncated: false };
      threadsFixture = [];

      renderOverview();

      expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    });
  });
});
