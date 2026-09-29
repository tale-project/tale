// @vitest-environment node

/**
 * The gate the lanes share and the indexer's by-name rule, side by side. A
 * sync import, an upload's registration, a replacement and the chat
 * backstop queue a file when `isRagIndexableFile` / `shouldRagIndexOnUpload`
 * say so, and the upload and replace dialogs and the composer promise its
 * index; the indexer then refuses the file by `unsupportedByName`. Where the
 * two disagreed, the file was queued and promised and its run ended
 * `unsupported_type`: an extension-less `README` stored as `text/plain` was
 * queued on its type and refused by its name.
 */

import { describe, expect, it } from 'vitest';

import {
  isRagIndexableFile,
  RAG_INDEXABLE_EXTENSIONS,
  shouldRagIndexOnUpload,
} from '../../../lib/shared/file-types.ts';
import { ALL_SUPPORTED_EXTENSIONS } from '../lib/knowledge/extraction/router.ts';
import { RAG_ERROR_UNSUPPORTED_TYPE } from './rag_error_codes.ts';
import { unsupportedByName } from './rag_unsupported.ts';

/** The one deliberate difference: the text extractor reads a `.log`, and the
 * platform does not index one by itself. */
const isLog = (fileName: string) => fileName.toLowerCase().endsWith('.log');

/** The indexer has an extractor for the name: its run does not end on
 * `unsupported_type` (an image goes on to its own refusal). */
const indexerHasExtractor = (fileName: string) =>
  unsupportedByName(fileName)?.code !== RAG_ERROR_UNSUPPORTED_TYPE;

/** The indexer reads the file's bytes: the name alone refuses nothing. */
const indexerReadsBytes = (fileName: string) =>
  unsupportedByName(fileName) === null;

/** Names and the type a browser or a provider would give them. */
const PAIRS: readonly (readonly [string, string])[] = [
  ['README', 'text/plain'],
  ['export', 'application/pdf'],
  ['README', 'application/octet-stream'],
  ['legacy.doc', 'text/plain'],
  [
    'minutes',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['Minutes 27.09', 'application/pdf'],
  ['notes.', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.eslintrc.json', 'application/json'],
  ['report.pdf', 'application/pdf'],
  ['REPORT.PDF', 'application/pdf'],
  ['notes.txt', 'text/plain'],
  ['archive.zip', 'application/zip'],
  ['standup.loop', 'application/octet-stream'],
  ['photo.png', 'image/png'],
  ['photo', 'image/png'],
  ['server.log', 'text/plain'],
];

describe('the lanes’ gate and the indexer agree on a file name', () => {
  it.each(PAIRS)(
    'isRagIndexableFile(%s) queues what the indexer has an extractor for',
    (fileName) => {
      expect(isRagIndexableFile(fileName)).toBe(
        indexerHasExtractor(fileName) && !isLog(fileName),
      );
    },
  );

  // Images and media take their own lanes by their type; every other upload
  // is queued exactly when the indexer reads its bytes.
  it.each(PAIRS)(
    'shouldRagIndexOnUpload(%s, %s) queues what the indexer reads',
    (fileName, contentType) => {
      expect(shouldRagIndexOnUpload(fileName, contentType)).toBe(
        indexerReadsBytes(fileName) && !isLog(fileName),
      );
    },
  );

  // The two extension lists are kept by hand in two places.
  it('holds for every extension either side knows', () => {
    const extensions = new Set([
      ...[...ALL_SUPPORTED_EXTENSIONS].map((ext) => ext.slice(1)),
      ...RAG_INDEXABLE_EXTENSIONS,
      'doc',
      'xls',
      'ppt',
      'zip',
      'loop',
    ]);
    const disagreements = [...extensions]
      .map((ext) => `file.${ext}`)
      .filter(
        (fileName) =>
          isRagIndexableFile(fileName) !==
          (indexerHasExtractor(fileName) && !isLog(fileName)),
      );
    expect(disagreements).toEqual([]);
  });
});
