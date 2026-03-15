// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockToast = vi.fn();
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

vi.mock('../../hooks/mutations', () => ({
  useDocumentUpload: () => ({
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

import { DocumentUploadDialog } from '../document-upload-dialog';

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(screen.getByText('common.actions.cancel')).toBeInTheDocument();
  });
});
