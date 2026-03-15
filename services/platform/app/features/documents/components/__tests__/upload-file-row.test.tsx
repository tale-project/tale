// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

import { UploadFileRow } from '../upload-file-row';

afterEach(cleanup);

describe('UploadFileRow', () => {
  const baseProps = {
    fileName: 'test-document.pdf',
    fileSize: 1_200_000,
    status: 'pending' as const,
    bytesLoaded: 0,
    bytesTotal: 1_200_000,
  };

  it('renders file name and type badge', () => {
    render(<UploadFileRow {...baseProps} />);

    expect(screen.getByText('test-document.pdf')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
  });

  it('shows remove button for pending files', () => {
    const onRemove = vi.fn();
    render(<UploadFileRow {...baseProps} onRemove={onRemove} />);

    const removeButton = screen.getByRole('button', {
      name: /remove test-document.pdf/i,
    });
    expect(removeButton).toBeInTheDocument();

    fireEvent.click(removeButton);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('shows progress bar and percentage for uploading files', () => {
    render(
      <UploadFileRow
        {...baseProps}
        status="uploading"
        bytesLoaded={600_000}
        bytesTotal={1_200_000}
      />,
    );

    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows check icon for completed files', () => {
    render(<UploadFileRow {...baseProps} status="completed" />);

    expect(screen.getByLabelText('Completed')).toBeInTheDocument();
  });

  it('shows error state and retry button for failed files', () => {
    const onRetry = vi.fn();
    render(
      <UploadFileRow
        {...baseProps}
        status="failed"
        error="Upload failed"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText(/test-document\.pdf/i)).toHaveTextContent(
      /— Failed/,
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', {
      name: /retry/i,
    });
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('applies red background for failed state', () => {
    const { container } = render(
      <UploadFileRow {...baseProps} status="failed" error="Network error" />,
    );

    const row = container.firstChild;
    expect(row).toHaveClass('bg-red-50');
    expect(row).toHaveClass('border-red-200');
  });
});
