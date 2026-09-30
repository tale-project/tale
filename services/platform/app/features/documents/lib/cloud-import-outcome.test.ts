import { describe, expect, it } from 'vitest';

import {
  readCloudImportAnswer,
  type CloudImportAnswer,
} from './cloud-import-outcome';

const LAPSE =
  'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.';
const isLapse = (error: unknown) =>
  typeof error === 'string' && error.includes('is not authorized');

const CAP = {
  code: 'FILE_SIZE_INVALID',
  message: 'The file exceeds the 512 MiB limit',
};

function answer(overrides: Partial<CloudImportAnswer>): CloudImportAnswer {
  return {
    success: false,
    results: [],
    totalFiles: 4,
    successCount: 0,
    skippedCount: 0,
    ...overrides,
  };
}

describe('readCloudImportAnswer', () => {
  it('counts the files a re-run skipped as imported', () => {
    expect(
      readCloudImportAnswer(
        answer({ success: true, successCount: 1, skippedCount: 3 }),
        isLapse,
      ),
    ).toEqual({ kind: 'completed', imported: 4, total: 4 });
  });

  it('reads the grant check sentence as access that ended, with how far it got', () => {
    expect(
      readCloudImportAnswer(
        answer({ successCount: 1, skippedCount: 1, error: LAPSE }),
        isLapse,
      ),
    ).toEqual({
      kind: 'interrupted',
      interruption: { imported: 2, total: 4 },
    });
  });

  it("names the first failed file with that failure's words", () => {
    expect(
      readCloudImportAnswer(
        answer({
          successCount: 2,
          results: [
            { fileName: 'a.docx', status: 'success' },
            { fileName: 'report.mov', status: 'error', reason: CAP },
            { fileName: 'b.docx', status: 'success' },
            { fileName: 'c.docx', status: 'error' },
          ],
        }),
        isLapse,
      ),
    ).toEqual({
      kind: 'partial',
      imported: 2,
      total: 4,
      failure: { name: 'report.mov', reason: CAP.message },
    });
  });

  // `firstFailureDetail` reads the first failure only: a fault there keeps
  // the counts alone, even when a later file was refused in words.
  it('says nothing more when the first failure was a fault', () => {
    expect(
      readCloudImportAnswer(
        answer({
          results: [
            { fileName: 'a.docx', status: 'error' },
            { fileName: 'report.mov', status: 'error', reason: CAP },
          ],
        }),
        isLapse,
      ),
    ).toEqual({ kind: 'failed', total: 4, failure: undefined });
  });

  // Any other `error` is the backend's own English: a failure, not a lapse.
  it('keeps an answer whose error is not the grant check a plain failure', () => {
    expect(
      readCloudImportAnswer(
        answer({
          error:
            'Cloud authorization could not be refreshed right now (HTTP 503) — the next sync retries',
        }),
        isLapse,
      ),
    ).toEqual({ kind: 'failed', total: 4, failure: undefined });
  });
});
