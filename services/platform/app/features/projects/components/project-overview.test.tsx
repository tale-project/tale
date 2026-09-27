import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

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
  icon?: string;
  color?: string;
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
vi.mock('@tale/ui/use-toast', () => ({
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

const PROJECT_ID = 'proj-1' as string;

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
      screen.getByText('Shown in the projects list and the Home panel.'),
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

  // Archived = read-only for everyone (the backend drops `canEdit` with it,
  // and this page drops it again from the row it holds): the identity form
  // is gone, the banner says why, and Restore stays — that is how it stops
  // being archived.
  it('reads as archived: banner, no identity form, Restore still offered', () => {
    projectFixture = {
      name: 'Getting started',
      description: 'A tour of the platform.',
      archivedAt: 1_700_000_000_000,
      canEdit: true,
      canAdminister: true,
    };

    renderOverview();

    expect(screen.getByText('This project is archived')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Name' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('A tour of the platform.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(
      screen.queryByText('You’re viewing this project'),
    ).not.toBeInTheDocument();
  });

  it('never shows the retired Get-started nudge, even on an empty project', () => {
    renderOverview();

    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
  });

  // The page is a configuration surface: all five blocks are settings
  // sections (Archive split out of the danger zone — a shelf, not a
  // destructive action), so the shared marker-driven divider rule draws the
  // hairline between each pair — including the one separating Description
  // from Instructions. Lose a marker and the page silently reads as one
  // undivided run of fields.
  it('frames Project, Instructions, Sharing, Archive, and the danger zone as settings sections', () => {
    const { container } = renderOverview();

    expect(container.querySelectorAll('[data-settings-section]')).toHaveLength(
      5,
    );
    // Both anchored sections keep their ids so deep links still land on
    // them — Sharing from the org pages, the danger zone from the chat
    // sidebar's folder menu.
    expect(container.querySelector('#project-sharing')).toHaveAttribute(
      'data-settings-section',
    );
    expect(container.querySelector('#project-danger')).toHaveAttribute(
      'data-settings-section',
    );
  });

  describe('save feedback', () => {
    it('places a name the server refused under its own field, with no toast', async () => {
      mockUpdateIdentity.mockRejectedValueOnce(
        new AppError({ code: 'PROJECT_NAME_INVALID' }),
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

  // The docs promise icon and color on General; the backend stored both all
  // along. The picker writes the pair into the identity form so the same Save
  // sends them through the identity mutation (`null` = the default pair).
  describe('icon and color', () => {
    it('sends the picked icon and color with the identity save', async () => {
      projectFixture = {
        name: 'Getting started',
        icon: 'Briefcase',
        color: 'emerald',
        canEdit: true,
        canAdminister: true,
      };
      const { user } = renderOverview();

      await user.click(
        screen.getByRole('button', { name: /Change icon and color/ }),
      );
      const colorGroup = await screen.findByRole('radiogroup', {
        name: 'Color',
      });
      expect(
        within(colorGroup).getByRole('radio', { name: 'Emerald' }),
      ).toBeChecked();
      await user.click(within(colorGroup).getByRole('radio', { name: 'Rose' }));
      const iconGroup = screen.getByRole('radiogroup', { name: 'Icon' });
      expect(
        within(iconGroup).getByRole('radio', { name: 'Briefcase' }),
      ).toBeChecked();
      await user.click(
        within(iconGroup).getByRole('radio', { name: 'Rocket' }),
      );
      await user.keyboard('{Escape}');

      await submitIdentityForm('Getting started');

      expect(mockUpdateIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ icon: 'Rocket', color: 'rose' }),
      );
    });

    it('keeps the default pair as null until the user picks', async () => {
      renderOverview();

      await submitIdentityForm('Renamed');

      expect(mockUpdateIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ icon: null, color: null }),
      );
    });
  });
});
