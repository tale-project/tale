// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

// Mock i18n — return the key so the failure assertions can match it directly.
// The happy-path/a11y tests never read translated text, so this is inert for
// them (it mirrors react-i18next's key-echo fallback when no provider is set).
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

// Capture toast calls. `useToast` is a standalone hook (no provider), so the
// happy-path/a11y tests are unaffected; the failure test asserts on this spy.
const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Mock the save-image mutation so the upload path resolves without a backend.
// `mockSaveImage` is reassigned (or given a one-shot resolve/reject) per-test —
// e.g. a deferred promise to drive the in-flight `isUploading` state, or a
// rejection to exercise the upload-failure branch.
let mockSaveImage = vi.fn().mockResolvedValue({ filename: 'logo.png' });
vi.mock('../hooks/mutations', () => ({
  useSaveImage: () => ({ mutateAsync: (args: unknown) => mockSaveImage(args) }),
}));

// The Next.js Image wrapper is only reached when an existing `currentUrl` is
// shown; render a plain <img> so jsdom has nothing to resolve.
vi.mock('@/app/components/ui/data-display/image', () => ({
  Image: (props: Record<string, unknown>) => (
    <img src={props.src as string} alt={props.alt as string} />
  ),
}));

import { ImageUploadField } from './image-upload-field';

const baseProps = {
  organizationId: 'org_demo',
  imageType: 'logo' as const,
  ariaLabel: 'Upload logo',
};

function makeFile(name: string, type: string) {
  return new File(['fake-image-bytes'], name, { type });
}

function dropFile(element: Element, file: File) {
  fireEvent.drop(element, { dataTransfer: { files: [file] } });
}

// Drive the hidden file input directly — the failure tests assert on the
// upload result rather than the drop-acceptance gate.
function selectFile() {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');
  const file = makeFile('logo.png', 'image/png');
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

const revokeObjectURL = vi.fn();

beforeEach(() => {
  mockSaveImage = vi.fn().mockResolvedValue({ filename: 'logo.png' });
  // jsdom has no object-URL implementation; stub create/revoke. `revokeObjectURL`
  // is a module-level spy so the failure test can assert the blob is freed.
  revokeObjectURL.mockReset();
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

describe('ImageUploadField', () => {
  it('renders an accessible upload control', () => {
    render(<ImageUploadField {...baseProps} onUpload={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: 'Upload logo' }),
    ).toBeInTheDocument();
  });

  // Happy path: a valid image dropped onto the control runs the upload and
  // reports the saved filename back to the parent.
  it('uploads a valid image dropped onto the control', async () => {
    const onUpload = vi.fn();
    render(<ImageUploadField {...baseProps} onUpload={onUpload} />);

    dropFile(
      screen.getByRole('button', { name: 'Upload logo' }),
      makeFile('logo.png', 'image/png'),
    );

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(mockSaveImage).toHaveBeenCalledTimes(1);
    expect(mockSaveImage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_demo',
        type: 'logo',
        mimeType: 'image/png',
      }),
    );
    expect(onUpload).toHaveBeenCalledWith('logo.png', expect.any(File));
  });

  // Edge: a second drop while an upload is in flight must be ignored so the
  // same control cannot fire two concurrent uploads.
  it('ignores a drop while an upload is already in flight', async () => {
    // Keep the first upload pending so `isUploading` stays true for the second.
    let resolveUpload: (value: { filename: string }) => void = () => {};
    mockSaveImage = vi.fn().mockImplementation(
      () =>
        new Promise<{ filename: string }>((resolve) => {
          resolveUpload = resolve;
        }),
    );

    render(<ImageUploadField {...baseProps} onUpload={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Upload logo' });

    dropFile(button, makeFile('logo.png', 'image/png'));
    // The control disables itself once the upload starts.
    await waitFor(() => expect(button).toBeDisabled());

    dropFile(button, makeFile('logo-2.png', 'image/png'));

    expect(mockSaveImage).toHaveBeenCalledTimes(1);
    resolveUpload({ filename: 'logo.png' });
  });

  // Edge: a valid file whose browser-reported MIME is blank/non-`image/*` is
  // still accepted via its extension (e.g. a `.ico` reporting empty type),
  // keeping the drop path in sync with the picker's `accept` list.
  it('accepts a dropped file with a non-image MIME but an accepted extension', async () => {
    const onUpload = vi.fn();
    render(<ImageUploadField {...baseProps} onUpload={onUpload} />);

    dropFile(
      screen.getByRole('button', { name: 'Upload logo' }),
      makeFile('favicon.ico', ''),
    );

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(mockSaveImage).toHaveBeenCalledTimes(1);
  });

  // Error: a non-image file is rejected before any upload is attempted.
  it('ignores a dropped non-image file', () => {
    const onUpload = vi.fn();
    render(<ImageUploadField {...baseProps} onUpload={onUpload} />);

    dropFile(
      screen.getByRole('button', { name: 'Upload logo' }),
      makeFile('notes.txt', 'text/plain'),
    );

    expect(mockSaveImage).not.toHaveBeenCalled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  describe('upload-failure handling', () => {
    it('logs the error, shows a destructive toast, and clears the preview when the upload fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onUpload = vi.fn();
      const onPreviewUrlChange = vi.fn();
      mockSaveImage.mockRejectedValueOnce(new Error('upload failed'));

      render(
        <ImageUploadField
          {...baseProps}
          onUpload={onUpload}
          onPreviewUrlChange={onPreviewUrlChange}
        />,
      );

      selectFile();

      await waitFor(() => expect(mockSaveImage).toHaveBeenCalled());

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
      expect(onUpload).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('does not log or toast when the upload succeeds', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const onUpload = vi.fn();
      mockSaveImage.mockResolvedValueOnce({ filename: 'logo.png' });

      render(<ImageUploadField {...baseProps} onUpload={onUpload} />);

      const file = selectFile();

      await waitFor(() =>
        expect(onUpload).toHaveBeenCalledWith('logo.png', file),
      );

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ImageUploadField {...baseProps} onUpload={vi.fn()} label="Logo" />,
      );
      await checkAccessibility(container);
    });
  });
});
