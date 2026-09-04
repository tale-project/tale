import { describe, expect, it } from 'vitest';

import { collectTaskBlobRefs } from './service.ts';

/**
 * The hard delete reclaims a task subtree's attachment/output blobs through
 * the shared ref-release seam; this pins WHICH refs it hands over — every
 * `fileId` (the `s3:` ref both columns hold, per files/access.ts) across
 * every task in the tree, de-duplicated, with malformed rows skipped rather
 * than failing the delete.
 */
describe('collectTaskBlobRefs — the blobs a task subtree holds', () => {
  it('collects every fileId from attachments and outputs across the tree', () => {
    const refs = collectTaskBlobRefs([
      {
        attachments: [{ fileId: 's3:org/a.pdf', fileName: 'a.pdf' }],
        outputs: [
          { fileId: 's3:org/out-1.docx', fileName: 'out-1.docx' },
          { fileId: 's3:org/out-2.xlsx', fileName: 'out-2.xlsx' },
        ],
      },
      {
        attachments: null,
        outputs: [{ fileId: 's3:org/child.md', fileName: 'child.md' }],
      },
    ]);
    expect(refs).toEqual([
      's3:org/a.pdf',
      's3:org/out-1.docx',
      's3:org/out-2.xlsx',
      's3:org/child.md',
    ]);
  });

  it('de-duplicates a ref two tasks list and ignores malformed entries', () => {
    const refs = collectTaskBlobRefs([
      { attachments: [{ fileId: 's3:org/shared.pdf' }], outputs: 'garbage' },
      {
        attachments: [{ fileId: 's3:org/shared.pdf' }, { fileName: 'no-ref' }],
        outputs: [null, 42, { fileId: '' }],
      },
    ]);
    expect(refs).toEqual(['s3:org/shared.pdf']);
  });

  it('answers nothing for a tree without files', () => {
    expect(collectTaskBlobRefs([{ attachments: null, outputs: null }])).toEqual(
      [],
    );
    expect(collectTaskBlobRefs([])).toEqual([]);
  });
});
