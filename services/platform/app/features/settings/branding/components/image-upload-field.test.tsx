// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';

// Mock the save-image mutation so the upload path resolves without a backend.
// `mockSaveImage` is reassigned per-test (e.g. to a deferred promise) to drive
// the in-flight `isUploading` state.
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

beforeEach(() => {
  mockSaveImage = vi.fn().mockResolvedValue({ filename: 'logo.png' });
  // jsdom does not implement object-URL APIs the component calls on upload.
  global.URL.createObjectURL = vi.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
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

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ImageUploadField {...baseProps} onUpload={vi.fn()} label="Logo" />,
      );
      await checkAccessibility(container);
    });
  });
});
