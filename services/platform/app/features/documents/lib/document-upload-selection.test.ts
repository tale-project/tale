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
  it('uses MIME identity when the current document has no extension — on a file that carries one', () => {
    const matching = new File(['text'], 'replacement.txt', {
      type: 'text/plain',
    });
    const different = new File(['pdf'], 'replacement.pdf', {
      type: 'application/pdf',
    });
    // The allowlist keys on the extension the name must carry (2026-09-13
    // evaluation, E2-01): a replacement without one is refused before its
    // MIME identity is consulted, as the server's bind refuses it.
    const extensionless = new File(['text'], 'replacement', {
      type: 'text/plain',
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
    expect(
      validateDocumentUploadSelection(
        extensionless,
        policy,
        undefined,
        'text/plain',
      ),
    ).toEqual({ kind: 'unsupported', fileName: 'replacement' });
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
