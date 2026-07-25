import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { ProjectOverview } from './project-overview';

// The general page opens directly with the "Project" section — the layout's
// header already names the project, so the page renders no second name
// heading, no stats line, and no New-chat CTA of its own. These tests pin
// that shape plus the per-field hints under name / description /
// instructions.

type ProjectFixture = {
  name: string;
  description?: string;
  archivedAt?: number;
  canEdit: boolean;
  canAdminister: boolean;
  teamId?: string;
  sharedWithTeamIds?: string[];
};

let projectFixture: ProjectFixture | null = null;

vi.mock('../hooks/queries', () => ({
  useProject: () => ({ project: projectFixture, isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectIdentity: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  // The instructions section is part of this page, so its write is
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
  });

  it('opens with the Project section — no duplicate name heading, stats line, or New-chat CTA', () => {
    renderOverview();

    expect(
      screen.getByRole('heading', { name: 'Project' }),
    ).toBeInTheDocument();
    // The layout's header owns the project name; the page repeats neither it
    // nor the retired stats/CTA header.
    expect(
      screen.queryByRole('heading', { name: /Getting started/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ chats?\b/)).not.toBeInTheDocument();
    expect(screen.queryByText('New chat')).not.toBeInTheDocument();
  });

  it('describes the name, description, and instructions fields', () => {
    renderOverview();

    expect(
      screen.getByText('Shown in the projects list and the chat sidebar.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A short summary that tells teammates what belongs here.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Every chat in this project starts with these instructions.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the read-only Project summary for viewers with a description', () => {
    projectFixture = {
      name: 'Getting started',
      description: 'A tour of the platform.',
      canEdit: false,
      canAdminister: false,
    };

    renderOverview();

    expect(
      screen.getByRole('heading', { name: 'Project' }),
    ).toBeInTheDocument();
    expect(screen.getByText('A tour of the platform.')).toBeInTheDocument();
  });

  it('never shows the retired Get-started nudge, even on an empty project', () => {
    renderOverview();

    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
  });
});
