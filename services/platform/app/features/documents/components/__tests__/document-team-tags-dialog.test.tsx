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

vi.mock('../../hooks/mutations', () => ({
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

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('@/app/components/ui/forms/select', () => ({
  Select: ({
    value,
    onValueChange,
    options,
    label,
    disabled,
    id,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    label?: string;
    disabled?: boolean;
    id?: string;
    placeholder?: string;
  }) => {
    return (
      <div data-testid="mock-select">
        {label && <label htmlFor={id}>{label}</label>}
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value)}
          data-testid="team-select"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  },
}));

import { DocumentTeamTagsDialog } from '../document-team-tags-dialog';

function selectTeam(teamValue: string) {
  const select = screen.getByTestId('team-select');
  fireEvent.change(select, { target: { value: teamValue } });
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

  it('renders the team select dropdown with all options', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    const select = screen.getByTestId('team-select');
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveTextContent('documents.teamTags.orgWide');
    expect(options[1]).toHaveTextContent('Sales');
    expect(options[2]).toHaveTextContent('Support');
    expect(options[3]).toHaveTextContent('Operations');
  });

  it('defaults to org-wide when no team is selected', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    const select = screen.getByTestId('team-select');
    expect(select).toHaveValue('__org_wide__');
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

  it('shows footer with disabled save when no teams', () => {
    mockTeamsData = { teams: [], isLoading: false };
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByText('common.actions.cancel')).toBeInTheDocument();
    expect(screen.getByText('common.actions.save')).toBeDisabled();
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

  it('pre-selects current team', () => {
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );
    const select = screen.getByTestId('team-select');
    expect(select).toHaveValue('team-1');
  });

  it('disables save when no changes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    const saveButton = screen.getByText('common.actions.save');
    expect(saveButton).toBeDisabled();
  });

  it('enables save when team changes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    selectTeam('team-1');

    const saveButton = screen.getByText('common.actions.save');
    expect(saveButton).toBeEnabled();
  });

  it('submits with the selected team id', async () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    selectTeam('team-1');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: ['team-1'],
    });
  });

  it('submits empty array when org-wide is selected', async () => {
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );

    selectTeam('__org_wide__');
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

    selectTeam('team-1');
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

    selectTeam('team-1');
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

    selectTeam('team-1');
    await act(async () => {
      fireEvent.click(screen.getByText('common.actions.save'));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('only allows single team selection', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    selectTeam('team-1');
    const select = screen.getByTestId('team-select');
    expect(select).toHaveValue('team-1');

    selectTeam('team-2');
    expect(select).toHaveValue('team-2');
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
      expect(screen.getByTestId('team-select')).toBeInTheDocument();
    });

    it('calls folder mutation when submitting with entityType folder', async () => {
      render(<DocumentTeamTagsDialog {...folderProps} />);

      selectTeam('team-1');
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

      selectTeam('team-1');
      await act(async () => {
        fireEvent.click(screen.getByText('common.actions.save'));
      });

      expect(mockMutateAsync).toHaveBeenCalledWith({
        documentId: 'doc-1',
        teamIds: ['team-1'],
      });
      expect(mockFolderMutateAsync).not.toHaveBeenCalled();
    });

    it('uses entityId prop correctly for folder submissions', async () => {
      const customProps = {
        ...folderProps,
        entityId: 'folder-custom-99',
      };
      render(<DocumentTeamTagsDialog {...customProps} />);

      selectTeam('team-3');
      await act(async () => {
        fireEvent.click(screen.getByText('common.actions.save'));
      });

      expect(mockFolderMutateAsync).toHaveBeenCalledWith({
        folderId: 'folder-custom-99',
        teamIds: ['team-3'],
      });
    });
  });
});
