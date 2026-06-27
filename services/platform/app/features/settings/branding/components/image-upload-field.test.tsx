// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// Mock i18n — return the key so assertions can match it directly.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

// Capture toast calls.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock the image save mutation so the upload path can be made to reject.
const mockMutateAsync = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useSaveImage: () => ({ mutateAsync: mockMutateAsync }),
}));

// Mock the Image component (avoids next/image plumbing in jsdom).
vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => (
    <img src={props.src as string} alt={props.alt as string} />
  ),
}));

import { ImageUploadField } from './image-upload-field';

const defaultProps = {
  organizationId: 'org_test',
  imageType: 'logo' as const,
  onUpload: vi.fn(),
  ariaLabel: 'Upload logo',
};

function selectFile() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');
  const file = new File(['x'], 'logo.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

const revokeObjectURL = vi.fn();

beforeEach(() => {
  // jsdom has no objectURL implementation; stub for create/revoke.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ImageUploadField upload-failure handling', () => {
  it('logs the error, shows a destructive toast, and clears the preview when the upload fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onPreviewUrlChange = vi.fn();
    mockMutateAsync.mockRejectedValueOnce(new Error('upload failed'));

    render(
      <ImageUploadField
        {...defaultProps}
        onPreviewUrlChange={onPreviewUrlChange}
      />,
    );

    selectFile();

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());

    // (b) console.error is called with the failure.
    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        '[branding image upload]',
        expect.any(Error),
      ),
    );

    // (a) the destructive toast fires with the i18n key.
    expect(mockToast).toHaveBeenCalledWith({
      title: 'error.imageUploadFailed',
      variant: 'destructive',
    });

    // (c) the preview/objectURL state is cleared (the optimistic preview is
    // first set to the blob URL, then reset to null on failure).
    expect(onPreviewUrlChange).toHaveBeenLastCalledWith(null);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // The upload-success callback never fires on failure.
    expect(defaultProps.onUpload).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('does not log or toast when the upload succeeds', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onUpload = vi.fn();
    mockMutateAsync.mockResolvedValueOnce({ filename: 'logo.png' });

    render(<ImageUploadField {...defaultProps} onUpload={onUpload} />);

    const file = selectFile();

    await waitFor(() =>
      expect(onUpload).toHaveBeenCalledWith('logo.png', file),
    );

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
