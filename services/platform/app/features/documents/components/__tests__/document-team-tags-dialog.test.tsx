// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('../../hooks/mutations', () => ({
  useUpdateDocument: () => ({ mutateAsync: mockMutateAsync }),
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

import { DocumentTeamTagsDialog } from '../document-team-tags-dialog';

describe('DocumentTeamTagsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    documentId: 'doc-1',
    documentName: 'Return policy v2.docx',
    currentTeamIds: [] as string[],
  };

  beforeEach(() => {
    mockTeamsData = { teams: mockTeams, isLoading: false };
    mockMutateAsync.mockResolvedValue(undefined);
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

  it('renders organization-wide option and all team checkboxes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    expect(screen.getByText('documents.teamTags.orgWide')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(screen.getByText('Operations')).toBeInTheDocument();
  });

  it('shows org-wide checkbox as checked by default (no teams selected)', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeChecked();
    expect(checkboxes[1]).not.toBeChecked();
    expect(checkboxes[2]).not.toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
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

  it('navigates to settings on go to settings click', async () => {
    mockTeamsData = { teams: [], isLoading: false };
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    await user.click(screen.getByText('documents.teamTags.goToSettings'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/settings/teams',
      params: { id: 'org-1' },
    });
  });

  it('pre-selects current teams and unchecks org-wide', () => {
    render(
      <DocumentTeamTagsDialog
        {...defaultProps}
        currentTeamIds={['team-1', 'team-2']}
      />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
  });

  it('toggles team selection on click', async () => {
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
  });

  it('deselects team when clicking an already-selected team', async () => {
    const user = userEvent.setup();
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );

    await user.click(screen.getByText('Sales'));
    expect(screen.getAllByRole('checkbox')[1]).not.toBeChecked();
  });

  it('allows selecting multiple teams', async () => {
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    await user.click(screen.getByText('Support'));

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();
    expect(checkboxes[3]).not.toBeChecked();
  });

  it('disables save when no changes', () => {
    render(<DocumentTeamTagsDialog {...defaultProps} />);
    const saveButton = screen.getByText('common.actions.save');
    expect(saveButton).toBeDisabled();
  });

  it('enables save when team changes', async () => {
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    const saveButton = screen.getByText('common.actions.save');
    expect(saveButton).toBeEnabled();
  });

  it('submits with the selected team ids', async () => {
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    await user.click(screen.getByText('Support'));
    await user.click(screen.getByText('common.actions.save'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: expect.arrayContaining(['team-1', 'team-2']),
    });
  });

  it('clears all teams when clicking organization-wide', async () => {
    const user = userEvent.setup();
    render(
      <DocumentTeamTagsDialog
        {...defaultProps}
        currentTeamIds={['team-1', 'team-2']}
      />,
    );

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).not.toBeChecked();
    expect(checkboxes[1]).toBeChecked();
    expect(checkboxes[2]).toBeChecked();

    await user.click(screen.getByText('documents.teamTags.orgWide'));

    const updatedCheckboxes = screen.getAllByRole('checkbox');
    expect(updatedCheckboxes[0]).toBeChecked();
    expect(updatedCheckboxes[1]).not.toBeChecked();
    expect(updatedCheckboxes[2]).not.toBeChecked();
    expect(updatedCheckboxes[3]).not.toBeChecked();
  });

  it('submits empty array when org-wide is selected', async () => {
    const user = userEvent.setup();
    render(
      <DocumentTeamTagsDialog {...defaultProps} currentTeamIds={['team-1']} />,
    );

    await user.click(screen.getByText('documents.teamTags.orgWide'));
    await user.click(screen.getByText('common.actions.save'));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      teamIds: [],
    });
  });

  it('shows success toast after save', async () => {
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    await user.click(screen.getByText('common.actions.save'));

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.teamTags.updated',
      variant: 'success',
    });
  });

  it('shows error toast on save failure', async () => {
    mockMutateAsync.mockRejectedValue(new Error('fail'));
    const user = userEvent.setup();
    render(<DocumentTeamTagsDialog {...defaultProps} />);

    await user.click(screen.getByText('Sales'));
    await user.click(screen.getByText('common.actions.save'));

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.teamTags.updateFailed',
      variant: 'destructive',
    });
  });

  it('closes dialog on cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    await user.click(screen.getByText('common.actions.cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes dialog after successful save', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <DocumentTeamTagsDialog {...defaultProps} onOpenChange={onOpenChange} />,
    );

    await user.click(screen.getByText('Sales'));
    await user.click(screen.getByText('common.actions.save'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
