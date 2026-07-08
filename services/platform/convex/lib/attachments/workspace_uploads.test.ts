// Workspace-upload planning: sanitized flat names under /user/uploads/,
// in-batch de-dupe, per-file and per-turn caps. Pure function — no mocks.

import { describe, expect, it } from 'vitest';

import type { Id } from '../../_generated/dataModel';
import { MAX_ATTACHMENTS_PER_TURN } from '../../agents/external_agent/attachment_files';
import { THREAD_FILE_MAX_BYTES } from '../../thread_files/schema';
import type { FileAttachment } from './types';
import { buildWorkspaceUploadPlan } from './workspace_uploads';

function att(fileName: string, fileSize = 100): FileAttachment {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- branded id for a pure planning test
    fileId: `store-${fileName}` as Id<'_storage'>,
    fileName,
    fileType: 'application/octet-stream',
    fileSize,
  };
}

describe('buildWorkspaceUploadPlan', () => {
  it('files sanitized basenames flat under /user/uploads/', () => {
    const plan = buildWorkspaceUploadPlan([
      att('report.pdf'),
      att('../../etc/passwd'),
      att('..'),
    ]);
    expect(plan.planned.map((p) => p.path)).toEqual([
      '/user/uploads/report.pdf',
      '/user/uploads/passwd',
      '/user/uploads/file',
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('de-dupes same names within one batch', () => {
    const plan = buildWorkspaceUploadPlan([att('a.png'), att('a.png')]);
    expect(plan.planned.map((p) => p.path)).toEqual([
      '/user/uploads/a.png',
      '/user/uploads/a-2.png',
    ]);
  });

  it('skips files over the per-file byte cap', () => {
    const plan = buildWorkspaceUploadPlan([
      att('huge.bin', THREAD_FILE_MAX_BYTES + 1),
      att('ok.bin', THREAD_FILE_MAX_BYTES),
    ]);
    expect(plan.planned.map((p) => p.path)).toEqual(['/user/uploads/ok.bin']);
    expect(plan.skipped).toEqual([{ name: 'huge.bin', reason: 'too_large' }]);
  });

  it('caps the batch at the per-turn attachment limit', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS_PER_TURN + 2 }, (_, i) =>
      att(`f${i}.txt`),
    );
    const plan = buildWorkspaceUploadPlan(many);
    expect(plan.planned).toHaveLength(MAX_ATTACHMENTS_PER_TURN);
    expect(plan.skipped).toEqual([
      { name: `f${MAX_ATTACHMENTS_PER_TURN}.txt`, reason: 'too_many' },
      { name: `f${MAX_ATTACHMENTS_PER_TURN + 1}.txt`, reason: 'too_many' },
    ]);
  });
});
