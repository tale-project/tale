// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  documentUploadAccept,
  documentUploadSelectionIssueMessage,
  validateDocumentUploadSelection,
} from './document-upload-selection';

const policy = {
  allowedExtensions: [],
  blockedExtensions: [],
  documentMaxFileSize: 100 * 1024 * 1024,
  policyEnabled: false,
};

describe('controlled-record replacement selection', () => {
  it('uses MIME identity when the current document has no extension', () => {
    const matching = new File(['text'], 'replacement', {
      type: 'text/plain',
    });
    const different = new File(['pdf'], 'replacement', {
      type: 'application/pdf',
    });

    expect(
      validateDocumentUploadSelection(
        matching,
        policy,
        undefined,
        'text/plain',
      ),
    ).toBeNull();
    expect(
      validateDocumentUploadSelection(
        different,
        policy,
        undefined,
        'text/plain',
      ),
    ).toEqual({ kind: 'formatMismatch' });
    expect(documentUploadAccept(policy, '*/*', undefined, 'text/plain')).toBe(
      'text/plain',
    );
  });

  it('formats selection limits with the app locale', () => {
    const calls: Array<[string, Record<string, string | number> | undefined]> =
      [];
    const t = (
      key: string,
      values?: Record<string, string | number>,
    ): string => {
      calls.push([key, values]);
      return key;
    };

    documentUploadSelectionIssueMessage(
      {
        kind: 'tooLarge',
        fileName: 'large.pdf',
        maxSizeMb: 100,
        currentSizeMb: 100.5,
      },
      t,
      'de',
    );

    expect(calls[1]).toEqual([
      'upload.fileSizeExceeded',
      {
        name: 'large.pdf',
        maxSize: '100',
        currentSize: '100,5',
      },
    ]);
  });
});
