import { ConvexError } from 'convex/values';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { ProjectOverview } from './project-overview';

// The general page opens directly with the "Project" section — the layout's
// header already names the project, so the page renders no second name
// heading, no stats line, and no New-chat CTA of its own. These tests pin
// that shape plus the per-field hints under name / description /
// instructions, the settings-section framing the shared dividers key on, and
// the save contract (field rejections under their input, never a toast).

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

const mockUpdateIdentity = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectIdentity: () => ({
    mutateAsync: mockUpdateIdentity,
    isPending: false,
  }),
  // The instructions section is part of this page, so its write is
  // reachable from here too.
  useUpdateProjectInstructions: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// The page must never toast: the grouped Save cluster in the project layout's
// tab strip owns every piece of save feedback. Spying on the store lets the
// tests assert that silence.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
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

// Save runs through the tab strip's cluster, which isn't mounted here, so the
// identity form is submitted natively — the same `editor.submit` path the
// cluster's button drives.
async function submitIdentityForm(nameValue: string) {
  // By role, not by label: the field row names its wrapper with the same text,
  // so a label query can resolve to the row instead of the control.
  const nameField = screen.getByRole('textbox', { name: 'Name' });
  fireEvent.change(nameField, { target: { value: nameValue } });
  const form = nameField.closest('form');
  if (!form) throw new Error('identity form not found');
  fireEvent.submit(form);
  await waitFor(() => expect(mockUpdateIdentity).toHaveBeenCalledTimes(1));
}

describe('ProjectOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateIdentity.mockResolvedValue(undefined);
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

  // The page is a configuration surface: both blocks are settings sections, so
  // the shared marker-driven divider rule draws the hairline between them. Lose
  // the marker and the page silently reads as one undivided run of fields.
  it('frames Project and Sharing as settings sections', () => {
    const { container } = renderOverview();

    expect(container.querySelectorAll('[data-settings-section]')).toHaveLength(
      2,
    );
    // The Sharing section keeps its anchor so deep links still land on it.
    expect(container.querySelector('#project-sharing')).toHaveAttribute(
      'data-settings-section',
    );
  });

  describe('save feedback', () => {
    it('places a name the server refused under its own field, with no toast', async () => {
      mockUpdateIdentity.mockRejectedValueOnce(
        new ConvexError({ code: 'PROJECT_NAME_INVALID' }),
      );
      renderOverview();

      await submitIdentityForm('Renamed');

      expect(
        await screen.findByText('Project name must be 1–80 characters.'),
      ).toBeInTheDocument();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it('stays silent on a successful save — the Save cluster flashes "Saved"', async () => {
      renderOverview();

      await submitIdentityForm('Renamed');

      expect(mockUpdateIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed' }),
      );
      expect(mockToast).not.toHaveBeenCalled();
    });
  });
});
