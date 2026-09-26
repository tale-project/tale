import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';

import { productImageUploadErrorKey } from './image-upload-error';

describe('productImageUploadErrorKey', () => {
  it.each([
    ['PRODUCT_IMAGE_ACTIVE_CONTENT', 'edit.imageActiveContent'],
    ['PRODUCT_IMAGE_INVALID', 'edit.imageUnsupported'],
    ['FILE_SIZE_INVALID', 'edit.imageTooLarge'],
    ['HTTP_500', 'edit.imageUploadFailed'],
  ])('maps %s to %s', (code, key) => {
    expect(productImageUploadErrorKey(new AppError({ code }))).toBe(key);
  });

  it('keeps the generic key for a network error', () => {
    expect(productImageUploadErrorKey(new TypeError('Failed to fetch'))).toBe(
      'edit.imageUploadFailed',
    );
  });
});
