// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

// The product image door refuses with codes the field has no words for — a
// role without product write access (`RBAC_FORBIDDEN`), a spent upload
// budget (`RATE_LIMITED`). The field used to answer each with "Image upload
// failed. Try again.", which is the wrong advice for a role refusal.

const { uploadImage, toastMock } = vi.hoisted(() => ({
  uploadImage: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock('../hooks/use-product-image-upload', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-product-image-upload')
  >()),
  useProductImageUpload: () => ({ uploadImage, isUploading: false }),
}));

vi.mock('@tale/ui/use-toast', () => ({ toast: toastMock }));

import { ProductImageField } from './product-image-field';

function pick() {
  const input = document.getElementById('product-image-upload');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('drop-zone input missing');
  }
  return input;
}

const png = () =>
  new File([new Uint8Array([137, 80, 78, 71])], 'shoe.png', {
    type: 'image/png',
  });

describe('ProductImageField upload refusals', () => {
  beforeEach(() => {
    uploadImage.mockReset();
    toastMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names a refusal it has no words for in the door’s own', async () => {
    // The products door answers `{ error: <code> }` only; the fetch
    // boundary repeats the code as the message.
    uploadImage.mockRejectedValue(
      new AppError({ code: 'RBAC_FORBIDDEN', message: 'RBAC_FORBIDDEN' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = render(<ProductImageField value="" onChange={vi.fn()} />);

    await user.upload(pick(), png());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'Image upload failed. Try again.',
        description: 'RBAC_FORBIDDEN',
        variant: 'destructive',
      }),
    );
    expect(
      screen.getByText('Image upload failed. Try again.'),
    ).toBeInTheDocument();
  });

  it('keeps its own words for a refusal it names', async () => {
    uploadImage.mockRejectedValue(
      new AppError({
        code: 'PRODUCT_IMAGE_INVALID',
        message: 'PRODUCT_IMAGE_INVALID',
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = render(<ProductImageField value="" onChange={vi.fn()} />);

    await user.upload(pick(), png());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title:
          "This file isn't a supported image. Use PNG, JPEG, WebP, GIF or SVG.",
        variant: 'destructive',
      }),
    );
  });

  it('adds nothing to a failure the door did not answer', async () => {
    uploadImage.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = render(<ProductImageField value="" onChange={vi.fn()} />);

    await user.upload(pick(), png());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: 'Image upload failed. Try again.',
        variant: 'destructive',
      }),
    );
  });
});
