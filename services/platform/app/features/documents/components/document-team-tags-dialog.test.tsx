// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  act,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const mockFolderMutateAsync = vi.fn();

vi.mock('../hooks/mutations', () => ({
  useUpdateDocument: () => ({ mutateAsync: mockMutateAsync }),
  useUpdateFolderTeams: () => ({ mutateAsync: mockFolderMutateAsync }),
}));

const mockTeams = [
  { id: 'team-1', name: 'Sales' },
  { id: 'team-2', name: 'Support' },
  { id: 'team-3', name: 'Operations' },
];

let mockTeamsData: { teams: typeof mockTeams | undefined; isLoading: boolean } =
  { teams: mockTeams, isLoading: false };

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => mockTeamsData,
}));

// Lightweight stand-in for the real multi-select: one checkbox per team that
// toggles membership in the selected set, plus an org-wide indicator when the
// selection is empty.
vi.mock('./team-multi-select', () => ({
  TeamMultiSelect: ({
    teams,
    selectedTeamIds,
    onSelectionChange,
    orgWideLabel,
    disabled,
  }: {
    teams: Array<{ id: string; name: string }>;
    selectedTeamIds: string[];
    onSelectionChange: (ids: string[]) => void;
    orgWideLabel: string;
    disabled?: boolean;
  }) => (
    <div data-testid="mock-team-multi-select">
      <span data-testid="selection">
        {selectedTeamIds.length === 0
          ? orgWideLabel
          : selectedTeamIds.join(',')}
      </span>
      {teams.map((team) => (
        <label key={team.id}>
          <input
            type="checkbox"
            data-testid={`team-${team.id}`}
            checked={selectedTeamIds.includes(team.id)}
            disabled={disabled}
            onChange={() =>
              onSelectionChange(
                selectedTeamIds.includes(team.id)
                  ? selectedTeamIds.filter((id) => id !== team.id)
                  : [...selectedTeamIds, team.id],
              )
            }
          />
          {team.name}
        </label>
      ))}
    </div>
  ),
}));

import { DocumentTeamTagsDialog } from './document-team-tags-dialog';

function toggleTeam(teamId: string) {
  fireEvent.click(screen.getByTestId(`team-${teamId}`));
}

describe('DocumentTeamTagsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    entityId: 'doc-1',
    documentName: 'Return policy v2.docx',
    currentTeamIds: [] as string[],
  };

  beforeEach(() => {
    mockTeamsData = { teams: mockTeams, isLoading: false };
    mockMutateAsync.mockResolvedValue(undefined);
    mockFolderMutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when not open', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog title', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(
      screen.getByRole('heading', { name: 'documents.teamTags.title' }),
    ).toBeInTheDocument();
  });

  it('shows the document name as description', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByText('Return policy v2.docx')).toBeInTheDocument();
  });

  it('extracts filename from path for description', () => {
    render(
      <DocumentTeamTagsDialog
        {...defaultProps}
        documentName="folder/subfolder/Report.pdf"
      />,
    );
    expect(screen.getByText('Report.pdf')).toBeInTheDocument();
  });

  it('renders a checkbox for every team', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByTestId('team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('team-team-2')).toBeInTheDocument();
    expect(screen.getByTestId('team-team-3')).toBeInTheDocument();
  });

  it('defaults to org-wide when no team is selected', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByTestId('selection')).toHaveTextContent(
      'documents.teamTags.orgWide',
    );
  });

  it('shows loading state', () => {
    mockTeamsData = { teams: undefined, isLoading: true };
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByText('common.actions.loading')).toBeInTheDocument();
  });

  it('shows empty state with title, description and settings link', () => {
    mockTeamsData = { teams: [], isLoading: false };
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(
      screen.getByText('documents.teamTags.noTeamsTitle'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('documents.teamTags.noTeamsDescription'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('documents.teamTags.goToSettings'),
    ).toBeInTheDocument();
  });

  it('navigates to settings on go to settings click', () => {
    mockTeamsData = { teams: [], isLoading: false };
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByText('documents.teamTags.goToSettings'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/teams',
      params: { id: 'org-1' },
    });
  });

  it('pre-selects the current teams', () => {
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );
    expect(screen.getByTestId('team-team-1')).toBeChecked();
    expect(screen.getByTestId('team-team-2')).not.toBeChecked();
  });

  // Core of #1325: a document already assigned to multiple teams must show all
  // of them selected and keep them on save (no silent drop to a single team).
  it('pre-selects multiple current teams and preserves them on save', async () => {
    render(
      <DocumentTeamTagsDialog
        {...defaultProps}
        currentTeamIds={['team-1', 'team-2']}
      />,
    );
    expect(screen.getByTestId('team-team-1')).toBeChecked();
    expect(screen.getByTestId('team-team-2')).toBeChecked();

    // Add a third team and save — all three must be submitted.
    toggleTeam('team-3');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: ['team-1', 'team-2', 'team-3'],
    });
  });

  it('disables save when no changes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByText('common.actions.save')).toBeDisabled();
  });

  it('enables save when the selection changes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    toggleTeam('team-1');
    expect(screen.getByText('common.actions.save')).toBeEnabled();
  });

  it('allows selecting multiple teams', async () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    toggleTeam('team-1');
    toggleTeam('team-2');
    expect(screen.getByTestId('team-team-1')).toBeChecked();
    expect(screen.getByTestId('team-team-2')).toBeChecked();

    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: ['team-1', 'team-2'],
    });
  });

  it('submits an empty array when all teams are deselected (org-wide)', async () => {
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );

    toggleTeam('team-1'); // deselect -> org-wide
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: [],
    });
  });

  it('shows success toast after save', async () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    toggleTeam('team-1');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.teamTags.updated',
      variant: 'success',
    });
  });

  it('shows error toast on save failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('fail'));
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    toggleTeam('team-1');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.teamTags.updateFailed',
      variant: 'destructive',
    });
  });

  it('closes dialog on cancel', () => {
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByText('common.actions.cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog after successful save', async () => {
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    toggleTeam('team-1');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  describe('folder entity type', () => {
    const folderProps = {
      ...defaultProps,
      entityId: 'folder-1',
      entityType: 'folder' as const,
      documentName: 'My Folder',
    };

    it('renders correctly with entityType folder', () => {
      render(<DocumentTeamTagsDialog {...folderProps} />);

      expect(
        screen.getByRole('heading', { name: 'documents.teamTags.title' }),
      ).toBeInTheDocument();
      expect(screen.getByText('My Folder')).toBeInTheDocument();
      expect(screen.getByTestId('mock-team-multi-select')).toBeInTheDocument();
    });

    it('calls folder mutation when submitting with entityType folder', async () => {
      render(<DocumentTeamTagsDialog {...folderProps} />);

      toggleTeam('team-1');
      await act(async () => {
        fireEvent.click(screen.getByText('common.actions.save'));
      });

      expect(mockFolderMutateAsync).toHaveBeenCalledWith({
        folderId: 'folder-1',
        teamIds: ['team-1'],
      });
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });

    it('calls document mutation when submitting with default entityType', async () => {
      render(<DocumentTeamTagsDialog {...defaultProps} />);

      toggleTeam('team-1');
      await act(async () => {
        fireEvent.click(screen.getByText('common.actions.save'));
      });

      expect(mockMutateAsync).toHaveBeenCalledWith({
        documentId: 'doc-1',
        teamIds: ['team-1'],
      });
      expect(mockFolderMutateAsync).not.toHaveBeenCalled();
    });
  });
});
