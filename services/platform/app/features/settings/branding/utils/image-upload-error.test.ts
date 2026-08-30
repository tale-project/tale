import { describe, expect, it } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';

import { imageUploadErrorToastKey } from './image-upload-error';

describe('imageUploadErrorToastKey', () => {
  it('maps each known saveImage BackendError code to its specific key', () => {
    expect(
      imageUploadErrorToastKey(new BackendError({ code: 'IMAGE_TOO_LARGE' })),
    ).toBe('error.imageTooLarge');
    expect(
      imageUploadErrorToastKey(
        new BackendError({ code: 'IMAGE_MIME_UNSUPPORTED' }),
      ),
    ).toBe('error.imageMimeUnsupported');
    expect(
      imageUploadErrorToastKey(
        new BackendError({ code: 'IMAGE_TYPE_INVALID' }),
      ),
    ).toBe('error.imageTypeInvalid');
  });

  it('reads the code from a duck-typed error data shape (HMR-safe)', () => {
    // Mimics a BackendError whose class identity differs across Vite chunks:
    // a plain object carrying the same `data` shape must still be classified.
    expect(
      imageUploadErrorToastKey({ data: { code: 'IMAGE_TOO_LARGE' } }),
    ).toBe('error.imageTooLarge');
  });

  it('falls back to the generic key for unknown / network errors', () => {
    expect(imageUploadErrorToastKey(new Error('network down'))).toBe(
      'error.imageUploadFailed',
    );
    expect(imageUploadErrorToastKey(undefined)).toBe('error.imageUploadFailed');
    expect(imageUploadErrorToastKey({ data: { code: 'ORG_FORBIDDEN' } })).toBe(
      'error.imageUploadFailed',
    );
  });
});
