import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { mapUploadError } from './map-upload-error';

// Identity translator: returns the key so assertions show which message was
// chosen, and captures the interpolation values so we can assert the quota /
// size numbers get threaded through.
function makeT() {
  const calls: Array<{
    key: string;
    values?: Record<string, string | number>;
  }> = [];
  const t = (key: string, values?: Record<string, string | number>) => {
    calls.push({ key, values });
    return key;
  };
  return { t, calls };
}

describe('mapUploadError', () => {
  it('maps a full volume quota to the actionable quota message with usage', () => {
    const { t, calls } = makeT();
    const err = new ConvexError({
      code: 'UPLOAD_POLICY_REJECTED',
      reasonCode: 'volume_exceeded',
      usedBytes: 1024 * 1024 * 1024,
      limitBytes: 1024 * 1024 * 1024,
    });

    expect(mapUploadError(err, t)).toBe('upload.quotaExceeded');
    // Both usage numbers are formatted and passed through (non-empty strings).
    expect(typeof calls[0].values?.used).toBe('string');
    expect(calls[0].values?.used).toBeTruthy();
    expect(typeof calls[0].values?.limit).toBe('string');
    expect(calls[0].values?.limit).toBeTruthy();
  });

  it('maps a policy file-size rejection to the size message with the limit', () => {
    const { t, calls } = makeT();
    const err = new ConvexError({
      code: 'UPLOAD_POLICY_REJECTED',
      reasonCode: 'file_too_large',
      limitBytes: 5 * 1024 * 1024,
    });

    expect(mapUploadError(err, t)).toBe('upload.fileTooLargeLimit');
    expect(calls[0].values?.limit).toBeTruthy();
  });

  it('maps the server FILE_TOO_LARGE code to the size message', () => {
    const { t } = makeT();
    const err = new ConvexError({
      code: 'FILE_TOO_LARGE',
      reasonCode: 'file_too_large',
      limitBytes: 100 * 1024 * 1024,
    });

    expect(mapUploadError(err, t)).toBe('upload.fileTooLargeLimit');
  });

  it('maps RATE_LIMITED to the rate-limit message', () => {
    const { t } = makeT();
    const err = new ConvexError({ code: 'RATE_LIMITED', retryAfterMs: 5000 });

    expect(mapUploadError(err, t)).toBe('upload.rateLimited');
  });

  it('maps blocked/not-allowed types to the unsupported message', () => {
    const { t } = makeT();
    for (const reasonCode of [
      'extension_blocked',
      'extension_not_allowed',
      'mime_not_allowed',
    ]) {
      const err = new ConvexError({
        code: 'UPLOAD_POLICY_REJECTED',
        reasonCode,
      });
      expect(mapUploadError(err, t)).toBe('upload.unsupportedFileType');
    }
  });

  it('falls back to the generic retry message for an unknown error', () => {
    const { t } = makeT();
    expect(mapUploadError(new Error('boom'), t)).toBe(
      'upload.uploadFailedRetry',
    );
    expect(mapUploadError(new ConvexError({ code: 'WAT' }), t)).toBe(
      'upload.uploadFailedRetry',
    );
  });
});
