// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

const mockToast = vi.fn();
const mockStageFiles = vi.fn();
const mockUploadFiles = vi.fn().mockResolvedValue({ success: true });
const mockRetryFile = vi.fn();
const mockClearTrackedFiles = vi.fn();
const mockCancelUpload = vi.fn(() => true);
const translationCalls: Array<{
  namespace: string;
  key: string;
  values?: Record<string, unknown>;
}> = [];
let capturedUploadOptions:
  | {
      replacementTarget?: {
        documentId: string;
        expectedRecordState: 'draft' | 'approved';
        expectedVersion: number;
        expectedFileId: string;
      };
      onSuccess?: (fileInfo: {
        name: string;
        storagePath: string;
        size: number;
        version?: number;
      }) => void;
    }
  | undefined;

vi.mock('@/lib/i18n/client', () => ({
  useT: (namespace: string) => ({
    t: (key: string, values?: Record<string, unknown>) => {
      translationCalls.push({ namespace, key, values });
      if (!values) return `${namespace}.${key}`;
      return Object.entries(values).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, String(value)),
        `${namespace}.${key}`,
      );
    },
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useUploadPolicy: () => ({
    maxFileSize: 10 * 1024 * 1024,
    allowedTypes: [],
    allowedExtensions: [],
    blockedExtensions: [],
    documentMaxFileSize: 100 * 1024 * 1024,
    policyEnabled: false,
  }),
}));

vi.mock('../hooks/queries', () => ({
  useUploadUsage: () => ({
    data: { limited: false, usedBytes: 0, limitBytes: null },
  }),
}));

interface MockTrackedFile {
  id: string;
  file: File;
  status:
    | 'pending'
    | 'uploading'
    | 'finalizing'
    | 'binding'
    | 'completed'
    | 'failed';
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
  retryable?: boolean;
}

let mockHookState: {
  isUploading: boolean;
  canCancelUpload: boolean;
  trackedFiles: MockTrackedFile[];
} = { isUploading: false, canCancelUpload: false, trackedFiles: [] };

vi.mock('../hooks/mutations', () => ({
  useDocumentUpload: (options: typeof capturedUploadOptions) => {
    capturedUploadOptions = options;
    return {
      stageFiles: mockStageFiles,
      uploadFiles: mockUploadFiles,
      retryFile: mockRetryFile,
      isUploading: mockHookState.isUploading,
      trackedFiles: mockHookState.trackedFiles,
      clearTrackedFiles: mockClearTrackedFiles,
      cancelUpload: mockCancelUpload,
      canCancelUpload: mockHookState.canCancelUpload,
    };
  },
}));

import { DocumentReplaceFileDialog } from './document-replace-file-dialog';

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  organizationId: 'org-1',
  documentId: 'doc-1',
  documentName: 'procedure.pdf',
  documentMimeType: 'application/pdf',
  documentExtension: 'pdf',
  recordVersion: 2,
  expectedFileId: 'storage-current',
  recordState: 'draft' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  translationCalls.length = 0;
  capturedUploadOptions = undefined;
  mockHookState = {
    isUploading: false,
    canCancelUpload: false,
    trackedFiles: [],
  };
});

describe('DocumentReplaceFileDialog', () => {
  it('targets the current controlled-record revision', () => {
    const { rerender } = render(
      <DocumentReplaceFileDialog {...defaultProps} />,
    );

    expect(capturedUploadOptions?.replacementTarget).toEqual({
      documentId: 'doc-1',
      expectedRecordState: 'draft',
      expectedVersion: 2,
      expectedFileId: 'storage-current',
    });
    rerender(
      <DocumentReplaceFileDialog
        {...defaultProps}
        recordVersion={3}
        expectedFileId="storage-newer"
        recordState="approved"
      />,
    );
    expect(capturedUploadOptions?.replacementTarget).toEqual({
      documentId: 'doc-1',
      expectedRecordState: 'draft',
      expectedVersion: 2,
      expectedFileId: 'storage-current',
    });
    expect(
      screen.getByText('documents.record.replace.title'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /documents\.record\.replace\.dropZoneAria/,
      }),
    ).toBeInTheDocument();
  });

  it('stages one same-format file as the replacement', async () => {
    const user = userEvent.setup();
    render(<DocumentReplaceFileDialog {...defaultProps} />);
    const input = document.getElementById('document-replacement-doc-1');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });

    await user.upload(input as HTMLInputElement, file);

    expect(mockStageFiles).toHaveBeenCalledWith([file], true);
  });

  it('rejects a replacement with a different extension before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<DocumentReplaceFileDialog {...defaultProps} />);
    const input = document.getElementById('document-replacement-doc-1');
    const file = new File(['updated'], 'updated-procedure.txt', {
      type: 'text/plain',
    });

    await user.upload(input as HTMLInputElement, file);

    expect(mockStageFiles).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'documents.record.replace.formatTitle',
        description: 'documents.record.replace.extensionMismatch',
        variant: 'destructive',
      }),
    );
  });

  it('binds a staged file and reports success', async () => {
    const user = userEvent.setup();
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: file.size,
        },
      ],
    };
    render(<DocumentReplaceFileDialog {...defaultProps} />);

    await user.click(
      screen.getByRole('button', {
        name: 'documents.record.replace.confirm',
      }),
    );
    expect(mockUploadFiles).toHaveBeenCalledOnce();

    capturedUploadOptions?.onSuccess?.({
      name: 'updated-procedure.pdf',
      storagePath: '',
      size: file.size,
      version: 7,
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.record.replace.success',
      variant: 'success',
    });
    expect(translationCalls).toContainEqual({
      namespace: 'documents',
      key: 'record.replace.success',
      values: { version: 7 },
    });
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opens an approved replacement without staleness and uses approved copy', async () => {
    const user = userEvent.setup();
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: file.size,
        },
      ],
    };
    render(
      <DocumentReplaceFileDialog
        {...defaultProps}
        recordState="approved"
        recordVersion={4}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(capturedUploadOptions?.replacementTarget).toEqual({
      documentId: 'doc-1',
      expectedRecordState: 'approved',
      expectedVersion: 4,
      expectedFileId: 'storage-current',
    });
    expect(
      screen.getByText('documents.record.replace.approvedDescription'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('documents.record.replace.approvedHistoryHint'),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', {
        name: 'documents.record.replace.approvedConfirm',
      }),
    );
    expect(mockUploadFiles).toHaveBeenCalledOnce();

    capturedUploadOptions?.onSuccess?.({
      name: 'updated-procedure.pdf',
      storagePath: '',
      size: file.size,
      version: 9,
    });
    expect(mockToast).toHaveBeenCalledWith({
      title: 'documents.record.replace.approvedSuccess',
      variant: 'success',
    });
    expect(translationCalls).toContainEqual({
      namespace: 'documents',
      key: 'record.replace.approvedSuccess',
      values: { approvedVersion: 4, version: 9 },
    });
  });

  it('prevents dismissal while uploading and exposes cancellation', async () => {
    const user = userEvent.setup();
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: true,
      canCancelUpload: true,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'uploading',
          bytesLoaded: 2,
          bytesTotal: file.size,
        },
      ],
    };
    render(<DocumentReplaceFileDialog {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);

    await user.click(
      screen.getByRole('button', {
        name: 'documents.upload.cancelUpload',
      }),
    );
    expect(mockCancelUpload).toHaveBeenCalledOnce();
    expect(mockClearTrackedFiles).toHaveBeenCalledOnce();
  });

  it('keeps cancellation disabled while the server binds the blob', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: true,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'binding',
          bytesLoaded: file.size,
          bytesTotal: file.size,
        },
      ],
    };

    render(<DocumentReplaceFileDialog {...defaultProps} />);

    expect(
      screen.getByRole('button', {
        name: 'documents.upload.cancelUpload',
      }),
    ).toBeDisabled();
  });

  it('keeps cancellation disabled while the blob is finalizing', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: true,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'finalizing',
          bytesLoaded: file.size,
          bytesTotal: file.size,
        },
      ],
    };

    render(<DocumentReplaceFileDialog {...defaultProps} />);

    expect(
      screen.getByRole('button', {
        name: 'documents.upload.cancelUpload',
      }),
    ).toBeDisabled();
  });

  it('hides retry while another upload operation is active', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: true,
      canCancelUpload: true,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'failed',
          bytesLoaded: 0,
          bytesTotal: file.size,
          error: 'Upload failed',
        },
      ],
    };

    render(<DocumentReplaceFileDialog {...defaultProps} />);

    expect(
      screen.queryByRole('button', { name: 'documents.upload.retry' }),
    ).not.toBeInTheDocument();
  });

  it('does not offer a retry for a stale replacement', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'failed',
          bytesLoaded: file.size,
          bytesTotal: file.size,
          error: 'documents.record.replace.staleRevision',
          retryable: false,
        },
      ],
    };

    render(<DocumentReplaceFileDialog {...defaultProps} />);

    expect(
      screen.queryByRole('button', { name: 'documents.upload.retry' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['version', { recordVersion: 3 }],
    ['file ID', { expectedFileId: 'storage-newer' }],
    ['state', { recordState: 'in_review' as const }],
  ])(
    'marks the dialog stale when the live %s diverges from its frozen target',
    async (_field, changedProps) => {
      const user = userEvent.setup();
      const file = new File(['updated'], 'updated-procedure.pdf', {
        type: 'application/pdf',
      });
      mockHookState = {
        isUploading: false,
        canCancelUpload: false,
        trackedFiles: [
          {
            id: 'replacement-1',
            file,
            status: 'pending',
            bytesLoaded: 0,
            bytesTotal: file.size,
          },
        ],
      };
      const { rerender } = render(
        <DocumentReplaceFileDialog {...defaultProps} />,
      );

      expect(
        screen.getByRole('button', {
          name: 'documents.record.replace.confirm',
        }),
      ).toBeEnabled();

      rerender(
        <DocumentReplaceFileDialog {...defaultProps} {...changedProps} />,
      );

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('documents.record.replace.staleDialog');
      expect(alert).not.toHaveAttribute('aria-live');
      expect(
        screen.getByRole('button', {
          name: /documents\.record\.replace\.dropZoneAria/,
        }),
      ).toHaveAttribute('aria-disabled', 'true');
      expect(
        screen.getByRole('button', {
          name: 'documents.record.replace.confirm',
        }),
      ).toBeDisabled();

      const input = document.getElementById(
        'document-replacement-doc-1',
      ) as HTMLInputElement;
      expect(input).toBeDisabled();
      await user.upload(
        input,
        new File(['newer'], 'newer-procedure.pdf', {
          type: 'application/pdf',
        }),
      );
      expect(mockStageFiles).not.toHaveBeenCalled();
    },
  );

  it('keeps a stale target locked until the dialog is reopened', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: file.size,
        },
      ],
    };
    const { rerender } = render(
      <DocumentReplaceFileDialog {...defaultProps} />,
    );

    rerender(
      <DocumentReplaceFileDialog
        {...defaultProps}
        expectedFileId="storage-newer"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'documents.record.replace.staleDialog',
    );

    // A later live-query value that resembles the original target must not
    // silently re-enable a dialog after it has observed a conflicting state.
    rerender(<DocumentReplaceFileDialog {...defaultProps} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'documents.record.replace.confirm',
      }),
    ).toBeDisabled();

    rerender(<DocumentReplaceFileDialog {...defaultProps} open={false} />);
    rerender(<DocumentReplaceFileDialog {...defaultProps} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'documents.record.replace.confirm',
      }),
    ).toBeEnabled();
  });

  it('latches an approved dialog stale when its live state diverges', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: file.size,
        },
      ],
    };
    const approvedProps = {
      ...defaultProps,
      recordState: 'approved' as const,
    };
    const { rerender } = render(
      <DocumentReplaceFileDialog {...approvedProps} />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(
      <DocumentReplaceFileDialog {...approvedProps} recordState="draft" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'documents.record.replace.approvedStaleDialog',
    );

    rerender(<DocumentReplaceFileDialog {...approvedProps} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'documents.record.replace.approvedConfirm',
      }),
    ).toBeDisabled();
  });

  it('blocks a dialog when a legal hold appears while it is open', () => {
    const file = new File(['updated'], 'updated-procedure.pdf', {
      type: 'application/pdf',
    });
    mockHookState = {
      isUploading: false,
      canCancelUpload: false,
      trackedFiles: [
        {
          id: 'replacement-1',
          file,
          status: 'pending',
          bytesLoaded: 0,
          bytesTotal: file.size,
        },
      ],
    };
    const { rerender } = render(
      <DocumentReplaceFileDialog {...defaultProps} />,
    );
    const confirm = screen.getByRole('button', {
      name: 'documents.record.replace.confirm',
    });
    expect(confirm).toBeEnabled();

    rerender(<DocumentReplaceFileDialog {...defaultProps} isHeld />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'documents.record.replace.blockedByHold',
    );
    expect(confirm).toBeDisabled();
    expect(
      document.getElementById('document-replacement-doc-1'),
    ).toBeDisabled();
  });

  it.each(['draft', 'approved'] as const)(
    'passes an accessibility audit for a %s target',
    async (recordState) => {
      const { container } = render(
        <DocumentReplaceFileDialog
          {...defaultProps}
          recordState={recordState}
        />,
      );
      await checkAccessibility(container);
    },
  );
});
