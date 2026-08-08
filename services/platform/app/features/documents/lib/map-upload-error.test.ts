import { ConvexError } from 'convex/values';
import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/utils/format-bytes';

import { isUploadErrorRetryable, mapUploadError } from './map-upload-error';

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

    expect(mapUploadError(err, t, 'de')).toBe('upload.quotaExceeded');
    expect(calls[0].values).toEqual({
      used: formatBytes(1024 * 1024 * 1024, 'de'),
      limit: formatBytes(1024 * 1024 * 1024, 'de'),
    });
  });

  it('maps a policy file-size rejection to the size message with the limit', () => {
    const { t, calls } = makeT();
    const err = new ConvexError({
      code: 'UPLOAD_POLICY_REJECTED',
      reasonCode: 'file_too_large',
      limitBytes: 5 * 1024 * 1024,
    });

    expect(mapUploadError(err, t, 'fr')).toBe('upload.fileTooLargeLimit');
    expect(calls[0].values?.limit).toBe(formatBytes(5 * 1024 * 1024, 'fr'));
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

  it('maps controlled-record replacement refusals to specific messages', () => {
    const { t, calls } = makeT();

    expect(
      mapUploadError(
        new ConvexError({
          code: 'DOCUMENT_RECORD_EXTENSION_MISMATCH',
          expectedExtension: 'pdf',
        }),
        t,
      ),
    ).toBe('record.replace.extensionMismatch');
    expect(calls[0].values).toEqual({ extension: 'pdf' });
    expect(
      mapUploadError(
        new ConvexError({ code: 'DOCUMENT_RECORD_FILE_UNCHANGED' }),
        t,
      ),
    ).toBe('record.replace.unchanged');
    expect(
      mapUploadError(
        new ConvexError({ code: 'DOCUMENT_RECORD_VERSION_MISMATCH' }),
        t,
      ),
    ).toBe('record.replace.staleRevision');
    expect(
      mapUploadError(new ConvexError({ code: 'LEGAL_HOLD_ACTIVE' }), t),
    ).toBe('record.replace.blockedByHold');
  });

  it.each([
    ['UPLOAD_INTENT_INVALID', 'record.replace.intentExpired'],
    ['UPLOAD_INTENT_REQUIRED', 'record.replace.intentExpired'],
    ['UPLOAD_BLOB_INVALID', 'record.replace.intentExpired'],
    ['UPLOAD_MIME_MISMATCH', 'record.replace.contentMismatch'],
    ['DOCUMENT_RECORD_REPLACEMENT_LIMIT', 'record.replace.historyLimit'],
    ['UPLOAD_INTENT_IN_PROGRESS', 'record.replace.finalizePending'],
  ])('maps %s to %s', (code, messageKey) => {
    const { t } = makeT();

    expect(mapUploadError(new ConvexError({ code }), t)).toBe(messageKey);
    expect(isUploadErrorRetryable(new ConvexError({ code }))).toBe(false);
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

  it('only retries failures that may succeed with the same staged bytes', () => {
    expect(
      isUploadErrorRetryable(
        new ConvexError({ code: 'DOCUMENT_RECORD_VERSION_MISMATCH' }),
      ),
    ).toBe(false);
    expect(
      isUploadErrorRetryable(
        new ConvexError({
          code: 'UPLOAD_POLICY_REJECTED',
          reasonCode: 'file_too_large',
        }),
      ),
    ).toBe(false);
    expect(
      isUploadErrorRetryable(new ConvexError({ code: 'RATE_LIMITED' })),
    ).toBe(true);
    expect(isUploadErrorRetryable(new Error('network'))).toBe(true);
  });
});
