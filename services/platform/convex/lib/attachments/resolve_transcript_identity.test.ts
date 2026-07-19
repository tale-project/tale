import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAttachmentStagePlan } from '../../agents/external_agent/attachment_files';
import {
  applyTranscriptIdentity,
  resolveTranscriptAttachmentIdentities,
} from './resolve_transcript_identity';
import { buildWorkspaceUploadPlan } from './workspace_uploads';

// ---------------------------------------------------------------------------
// Regression coverage for the mislabelled video-link transcript on disk.
//
// `bindCompletedJobsToMessage` stamps transcript attachments with the
// 'video/mp4' routing sentinel and the extension-less video title, while the
// blob is transcript text. The workspace filer and the external-agent stager
// copied those display fields verbatim, so /user/uploads carried e.g.
// "It Broke?" · video/mp4 · 1.8 KB whose bytes were UTF-8 text — unreadable
// in the Canvas preview and a lie in the agent's preamble. The resolver
// restores the synthetic fileMetadata row's real identity
// (`"<title>.txt"`, text/plain) at the staging boundary.
// ---------------------------------------------------------------------------

const TRANSCRIPT_ATTACHMENT = {
  fileId: 'storage-1',
  fileName: 'It Broke?',
  fileType: 'video/mp4',
  fileSize: 1_800,
};

const VIDEO_LINK_META = {
  source: 'video_link',
  fileName: 'It Broke?.txt',
  contentType: 'text/plain; charset=utf-8',
};

describe('applyTranscriptIdentity', () => {
  it('restores the fileMetadata identity for video_link rows', () => {
    const resolved = applyTranscriptIdentity(
      TRANSCRIPT_ATTACHMENT,
      VIDEO_LINK_META,
    );

    expect(resolved).toEqual({
      fileId: 'storage-1',
      fileName: 'It Broke?.txt',
      fileType: 'text/plain; charset=utf-8',
      fileSize: 1_800,
    });
  });

  it('keeps regular uploads untouched', () => {
    const upload = {
      fileId: 'storage-2',
      fileName: 'report.pdf',
      fileType: 'application/pdf',
      fileSize: 5_000,
    };

    expect(
      applyTranscriptIdentity(upload, {
        source: 'user_upload',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
      }),
    ).toBe(upload);
    expect(applyTranscriptIdentity(upload, null)).toBe(upload);
  });

  it('lands the transcript as a .txt in the workspace upload plan', () => {
    const { planned } = buildWorkspaceUploadPlan([
      applyTranscriptIdentity(TRANSCRIPT_ATTACHMENT, VIDEO_LINK_META),
    ]);

    expect(planned).toHaveLength(1);
    expect(planned[0].path).toBe('/user/uploads/It Broke?.txt');
    expect(planned[0].attachment.fileType).toBe('text/plain; charset=utf-8');
  });

  it('lands the transcript as a .txt in the external-agent stage plan', () => {
    const plan = buildAttachmentStagePlan('msg-1', [
      applyTranscriptIdentity(TRANSCRIPT_ATTACHMENT, VIDEO_LINK_META),
    ]);

    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].absPath).toBe('/user/uploads/msg-1/It Broke?.txt');
    // The preamble prints this fileType — the agent must read "text/plain",
    // not be told it has an mp4.
    expect(plan.planned[0].fileType).toBe('text/plain; charset=utf-8');
  });
});

describe('resolveTranscriptAttachmentIdentities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves video_link rows and passes others through', async () => {
    const upload = {
      fileId: 'storage-2',
      fileName: 'report.pdf',
      fileType: 'application/pdf',
      fileSize: 5_000,
    };
    const runQuery = vi.fn().mockImplementation((_ref, args) => {
      if (args.storageId === 'storage-1') {
        return Promise.resolve(VIDEO_LINK_META);
      }
      return Promise.resolve({
        source: 'user_upload',
        fileName: 'report.pdf',
        contentType: 'application/pdf',
      });
    });

    const resolved = await resolveTranscriptAttachmentIdentities(
      { runQuery } as never,
      [TRANSCRIPT_ATTACHMENT, upload],
    );

    expect(resolved[0].fileName).toBe('It Broke?.txt');
    expect(resolved[0].fileType).toBe('text/plain; charset=utf-8');
    expect(resolved[1]).toBe(upload);
  });

  it('fails open on a lookup error, keeping the display identity', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runQuery = vi.fn().mockRejectedValue(new Error('db hiccup'));

    const resolved = await resolveTranscriptAttachmentIdentities(
      { runQuery } as never,
      [TRANSCRIPT_ATTACHMENT],
    );

    expect(resolved[0]).toBe(TRANSCRIPT_ATTACHMENT);
    expect(console.warn).toHaveBeenCalled();
  });
});
