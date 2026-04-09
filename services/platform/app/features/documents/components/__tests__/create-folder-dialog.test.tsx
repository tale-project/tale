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

const mockCreateFolder = vi.fn();
const mockToast = vi.fn();

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

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

const mockTeams = [
  { id: 'team-1', name: 'Sales' },
  { id: 'team-2', name: 'Support' },
];

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: mockTeams, isLoading: false }),
}));

vi.mock('../../hooks/mutations', () => ({
  useCreateFolder: () => ({ mutateAsync: mockCreateFolder }),
}));

vi.mock('@/app/components/ui/forms/select', () => ({
  Select: ({
    value,
    onValueChange,
    options,
    label,
    id,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    label?: string;
    id?: string;
    placeholder?: string;
  }) => {
    return (
      <div data-testid="mock-select">
        {label && <label htmlFor={id}>{label}</label>}
        <select
          id={id}
          value={value}
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

import { CreateFolderDialog } from '../create-folder-dialog';

function getNameInput() {
  return screen.getByPlaceholderText('documents.folder.folderNamePlaceholder');
}

async function fillAndSubmit(name: string) {
  const input = getNameInput();
  await act(async () => {
    fireEvent.change(input, { target: { value: name } });
  });
  const submitButton = screen.getByRole('button', {
    name: 'documents.folder.createFolder',
  });
  await act(async () => {
    fireEvent.click(submitButton);
  });
}

describe('CreateFolderDialog', () => {
  const defaultProps = {
    organizationId: 'org-1',
    open: true,
    onOpenChange: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    mockCreateFolder.mockResolvedValue('folder-new');
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows success toast after creating folder', async () => {
    render(<CreateFolderDialog {...defaultProps} />);
    await fillAndSubmit('Reports');

    expect(mockCreateFolder).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'Reports',
      parentId: undefined,
      teamId: undefined,
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.folder.created',
      variant: 'success',
    });
  });

  it('shows friendly duplicate name error instead of raw server error', async () => {
    mockCreateFolder.mockRejectedValue(
      new Error(
        '[Request ID: abc123] Server Error\nUncaught Error: A folder with this name already exists\n    at handler (convex/folders/mutations.ts:117:5)',
      ),
    );

    render(<CreateFolderDialog {...defaultProps} />);
    await fillAndSubmit('Existing Folder');

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.folder.duplicateName',
      variant: 'destructive',
    });
  });

  it('shows generic error for non-duplicate failures', async () => {
    mockCreateFolder.mockRejectedValue(new Error('Network error'));

    render(<CreateFolderDialog {...defaultProps} />);
    await fillAndSubmit('Some Folder');

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.folder.createFailed',
      variant: 'destructive',
    });
  });

  it('shows generic error when error is not an Error instance', async () => {
    mockCreateFolder.mockRejectedValue('string error');

    render(<CreateFolderDialog {...defaultProps} />);
    await fillAndSubmit('Another Folder');

    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.folder.createFailed',
      variant: 'destructive',
    });
  });
});
