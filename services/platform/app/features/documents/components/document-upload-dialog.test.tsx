// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
const mockStageFiles = vi.fn();
const mockUploadFiles = vi.fn().mockResolvedValue({ success: true });
const mockCancelUpload = vi.fn();
const mockClearTrackedFiles = vi.fn();
const mockRetryFile = vi.fn();
const mockRetryAllFailed = vi.fn();
const mockRemoveTrackedFile = vi.fn();

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
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
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/app/hooks/use-team-filter', () => ({
  useTeamFilter: () => ({ selectedTeamId: null }),
}));

const mockTeams = [
  { id: 'team-1', name: 'Sales' },
  { id: 'team-2', name: 'Support' },
];

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: mockTeams, isLoading: false }),
}));

// Destination folder lookup (#1469). Default: no folder / no team binding.
let mockFolderData: { teamId?: string } | undefined = undefined;
vi.mock('../hooks/queries', () => ({
  useFolder: () => ({ data: mockFolderData }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({
    maxFileSize: 10 * 1024 * 1024,
    allowedTypes: ['application/pdf', 'image/png'],
    documentMaxFileSize: 50 * 1024 * 1024,
    policyEnabled: false,
  }),
}));

interface MockTrackedFile {
  id: string;
  file: File;
  status: string;
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
}

let mockHookState: {
  isUploading: boolean;
  trackedFiles: MockTrackedFile[];
  completedCount: number;
  failedCount: number;
  totalCount: number;
  allCompleted: boolean;
  hasFailures: boolean;
} = {
  isUploading: false,
  trackedFiles: [],
  completedCount: 0,
  failedCount: 0,
  totalCount: 0,
  allCompleted: false,
  hasFailures: false,
};

vi.mock('../hooks/mutations', () => ({
  useDocumentUpload: () => ({
    stageFiles: mockStageFiles,
    uploadFiles: mockUploadFiles,
    retryFile: mockRetryFile,
    retryAllFailed: mockRetryAllFailed,
    isUploading: mockHookState.isUploading,
    trackedFiles: mockHookState.trackedFiles,
    removeTrackedFile: mockRemoveTrackedFile,
    clearTrackedFiles: mockClearTrackedFiles,
    cancelUpload: mockCancelUpload,
    completedCount: mockHookState.completedCount,
    failedCount: mockHookState.failedCount,
    totalCount: mockHookState.totalCount,
    allCompleted: mockHookState.allCompleted,
    hasFailures: mockHookState.hasFailures,
  }),
}));
import { checkAccessibility } from '@/test/utils/a11y';

import { DocumentUploadDialog } from './document-upload-dialog';

beforeEach(() => {
  vi.clearAllMocks();
  mockFolderData = undefined;
  mockHookState = {
    isUploading: false,
    trackedFiles: [],
    completedCount: 0,
    failedCount: 0,
    totalCount: 0,
    allCompleted: false,
    hasFailures: false,
  };
});

describe('DocumentUploadDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    organizationId: 'org-1',
  };

  it('renders dialog with title and drop zone', () => {
    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText('documents.upload.importDocuments'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('documents.upload.dropZoneTitle'),
    ).toBeInTheDocument();
  });

  it('renders team selection area with org-wide default', () => {
    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText('documents.upload.selectTeams'),
    ).toBeInTheDocument();
    expect(screen.getByText('documents.teamTags.orgWide')).toBeInTheDocument();
  });

  // Regression test for #1469: uploading into a team-scoped folder must lock
  // the team selection to that folder's team (the create mutation forces it),
  // instead of presenting a freely-editable selector.
  it('locks the team selection to the folder team when uploading into a team folder', () => {
    mockFolderData = { teamId: 'team-1' };
    render(<DocumentUploadDialog {...defaultProps} folderId="folder-1" />);

    // The folder's team (Sales) is pre-selected and the inheritance hint shows.
    expect(screen.getByText('Sales')).toBeInTheDocument();
    expect(
      screen.getByText('documents.upload.teamLockedToFolder'),
    ).toBeInTheDocument();

    // The TeamMultiSelect control must be disabled to enforce the lock.
    const teamSelector = screen.getByRole('combobox');
    expect(teamSelector).toHaveAttribute('aria-disabled', 'true');

    // No hint / free selection for an org-wide folder is covered by the
    // default-props test above (mockFolderData undefined).
  });

  it('renders drop zone description with file types', () => {
    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText(/documents\.upload\.dropZoneDescription/),
    ).toBeInTheDocument();
  });

  it('shows cancel button when uploading', () => {
    mockHookState = {
      isUploading: true,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'uploading',
          bytesLoaded: 500,
          bytesTotal: 1000,
        },
      ],
      completedCount: 0,
      failedCount: 0,
      totalCount: 1,
      allCompleted: false,
      hasFailures: false,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText('documents.upload.cancelUpload'),
    ).toBeInTheDocument();
  });

  it('shows success banner when all files completed', () => {
    mockHookState = {
      isUploading: false,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'completed',
          bytesLoaded: 1000,
          bytesTotal: 1000,
        },
      ],
      completedCount: 1,
      failedCount: 0,
      totalCount: 1,
      allCompleted: true,
      hasFailures: false,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText(/documents\.upload\.documentsUploadedSuccessfully/),
    ).toBeInTheDocument();
  });

  it('shows retry button when files have failed', () => {
    mockHookState = {
      isUploading: false,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'failed',
          bytesLoaded: 0,
          bytesTotal: 1000,
          error: 'Upload failed',
        },
      ],
      completedCount: 0,
      failedCount: 1,
      totalCount: 1,
      allCompleted: false,
      hasFailures: true,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    expect(
      screen.getByText('documents.upload.retryUpload'),
    ).toBeInTheDocument();
  });

  it('shows upload button when files are staged as pending', () => {
    mockHookState = {
      isUploading: false,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: 1000,
        },
      ],
      completedCount: 0,
      failedCount: 0,
      totalCount: 1,
      allCompleted: false,
      hasFailures: false,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    const uploadButton = screen.getByText('documents.upload.uploadDocuments');
    expect(uploadButton).toBeInTheDocument();
    expect(uploadButton.closest('button')).not.toBeDisabled();
  });

  it('disables upload button while uploading', () => {
    mockHookState = {
      isUploading: true,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'uploading',
          bytesLoaded: 500,
          bytesTotal: 1000,
        },
      ],
      completedCount: 0,
      failedCount: 0,
      totalCount: 1,
      allCompleted: false,
      hasFailures: false,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    const uploadButton = screen.getByText('documents.upload.uploadDocuments');
    expect(uploadButton.closest('button')).toBeDisabled();
  });

  it('disables upload button after all files completed', () => {
    mockHookState = {
      isUploading: false,
      trackedFiles: [
        {
          id: 'file-1',
          file: new File(['content'], 'test.pdf', {
            type: 'application/pdf',
          }),
          status: 'completed',
          bytesLoaded: 1000,
          bytesTotal: 1000,
        },
      ],
      completedCount: 1,
      failedCount: 0,
      totalCount: 1,
      allCompleted: true,
      hasFailures: false,
    };

    render(<DocumentUploadDialog {...defaultProps} />);

    const uploadButton = screen.getByText('documents.upload.uploadDocuments');
    expect(uploadButton.closest('button')).toBeDisabled();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DocumentUploadDialog {...defaultProps} />);
      await checkAccessibility(container);
    });
  });
});
