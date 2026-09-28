import { FIELD_ROW_FRAME } from '@tale/ui/field-shell';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ProjectSharingSection } from './project-sharing-section';

/**
 * The audience editor confirms a change that NARROWS access — from
 * organization-wide to some teams, or dropping a team while others remain —
 * and saves a widening (adding a team, or clearing every team so the whole
 * organization sees the project) straight away. Clearing the last team used
 * to be mistaken for a narrowing: the removed team was "no longer in the
 * upcoming set", although everyone, that team included, keeps access.
 */
const { updateSharing, orgTeams } = vi.hoisted(() => ({
  updateSharing: vi.fn(),
  orgTeams: {
    current: [
      { id: 't-one', name: 'Team One', memberCount: 2, createdAt: 0 },
      { id: 't-two', name: 'Team Two', memberCount: 3, createdAt: 0 },
    ],
  },
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateProjectSharing: () => ({
    mutateAsync: updateSharing,
    isPending: false,
  }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: orgTeams.current, isLoading: false }),
  useTeamNames: () => ({
    nameOf: (id: string) => ({ 't-one': 'Team One', 't-two': 'Team Two' })[id],
    isLoading: false,
    teams: [],
  }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

const NARROWS = /This change narrows access/;

function renderSection(teamIds: string[], canAdminister = true) {
  return render(
    <ProjectSharingSection
      projectId="p-1"
      organizationId="org-1"
      teamIds={teamIds}
      canAdminister={canAdminister}
    />,
  );
}

describe('ProjectSharingSection', () => {
  it('saves straight away when the last team is cleared — the whole organization gains access', async () => {
    updateSharing.mockResolvedValueOnce(undefined);
    const { user } = renderSection(['t-one']);
    await user.click(screen.getByRole('button', { name: 'Remove Team One' }));
    await waitFor(() =>
      expect(updateSharing).toHaveBeenCalledWith({
        projectId: 'p-1',
        teamIds: [],
      }),
    );
    expect(screen.queryByText(NARROWS)).not.toBeInTheDocument();
  });

  it('asks before dropping one of several teams, and saves only on Confirm', async () => {
    updateSharing.mockClear();
    updateSharing.mockResolvedValueOnce(undefined);
    const { user } = renderSection(['t-one', 't-two']);
    await user.click(screen.getByRole('button', { name: 'Remove Team One' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(NARROWS);
    expect(updateSharing).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(updateSharing).toHaveBeenCalledWith({
        projectId: 'p-1',
        teamIds: ['t-two'],
      }),
    );
  });

  it('asks before taking an organization-wide project to some teams', async () => {
    updateSharing.mockClear();
    const { user } = renderSection([]);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Team One' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(NARROWS);
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it('shows a non-admin the audience by name, read-only', () => {
    renderSection(['t-two'], false);
    expect(screen.getByText('Team Two')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

const AUDIENCE_HELP =
  /^The teams that can see this project\. Empty means everyone in the organization\./;

describe('ProjectSharingSection accessibility', () => {
  it('names the Audience combobox', () => {
    renderSection([]);
    expect(
      screen.getByRole('combobox', { name: 'Audience' }),
    ).toBeInTheDocument();
  });

  // Regression (#3522 review): the row shows the help beside the picker, but
  // only the combobox itself can carry it to a screen reader — the row's
  // wrapper is a plain div. Before a narrowing change the user must hear that
  // an empty audience means the whole organization.
  it('describes the Audience combobox by the row’s help', () => {
    renderSection(['t-one']);
    const combobox = screen.getByRole('combobox', { name: 'Audience' });
    expect(combobox).toHaveAccessibleName('Audience');
    expect(combobox).toHaveAccessibleDescription(AUDIENCE_HELP);
  });
});

/**
 * The Sharing section sits under the Project section on the project's General
 * page, so it takes the same chrome: a settings field row — label and help on
 * the left, the control pinned in the shared control column on the right —
 * inside the divided field list, not a free-standing (and unnamed) form group.
 */
describe('ProjectSharingSection chrome', () => {
  /** The settings field row around `content`, by the row's own marker. */
  function fieldRowAround(content: HTMLElement) {
    const row = content.closest<HTMLElement>('[data-settings-field-row]');
    if (!row) throw new Error('no settings field row around the content');
    return row;
  }

  /** A `role="group"` nothing names — noise a screen reader announces. */
  function unnamedGroups() {
    return screen
      .queryAllByRole('group')
      .filter(
        (group) =>
          !group.hasAttribute('aria-labelledby') &&
          !group.hasAttribute('aria-label'),
      );
  }

  it('puts the Audience picker in a field row with its help beside it', () => {
    const { container } = renderSection(['t-one']);
    const row = fieldRowAround(
      screen.getByRole('combobox', { name: 'Audience' }),
    );

    expect(within(row).getByText('Audience')).toBeInTheDocument();
    expect(row.className).toContain(FIELD_ROW_FRAME);
    expect(within(row).getByText(AUDIENCE_HELP)).toBeInTheDocument();
    // No `<label>` pointing at the combobox div, and no unnamed group.
    expect(container.querySelector('label')).toBeNull();
    expect(unnamedGroups()).toHaveLength(0);
  });

  it('shows a non-admin the effective audience in the same kind of row', () => {
    renderSection(['t-two'], false);
    const row = fieldRowAround(screen.getByText('Team Two'));

    expect(within(row).getByText('Effective audience')).toBeInTheDocument();
    expect(row.className).toContain(FIELD_ROW_FRAME);
    expect(unnamedGroups()).toHaveLength(0);
  });

  it('offers the create-a-team link in the Audience row when there are no teams', () => {
    const previous = orgTeams.current;
    orgTeams.current = [];
    try {
      renderSection([]);
      const row = fieldRowAround(
        screen.getByRole('link', { name: 'Create a team' }),
      );

      expect(within(row).getByText('Audience')).toBeInTheDocument();
      expect(row.className).toContain(FIELD_ROW_FRAME);
      expect(within(row).getByText(/No teams yet\./)).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    } finally {
      orgTeams.current = previous;
    }
  });
});
