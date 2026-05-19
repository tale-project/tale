import { describe, expect, it } from 'vitest';

import { formatVideoLinkAttachmentMarkdown } from './video-link-markdown';

/**
 * Golden tests: the output here must stay byte-identical to the inline
 * template the server used to carry in `start_agent_chat.ts:653`
 * (replaced by a call to this formatter in the same commit). The client
 * optimistic-render path injects this same string into the pending
 * message body so the bubble shape doesn't change on the persisted
 * swap. If anything in the template drifts — even whitespace — the
 * optimistic→persisted reflow returns.
 */
describe('formatVideoLinkAttachmentMarkdown', () => {
  it('renders the full template with all fields populated', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_storage_abc',
      fileName: 'Chengdu China,...side A Forest',
      fileType: 'video/mp4',
      fileSize: 238923776,
      videoTitle: 'Chengdu China — A Walk Through the Forest',
      videoUploader: 'ExampleChannel',
      sourcePlatform: 'YouTube',
      videoDurationSec: 305,
    });
    expect(out).toBe(
      '🎬 [Chengdu China — A Walk Through the Forest] (video from YouTube, 5m, uploader: ExampleChannel) — transcript indexed; call document_retrieve(fileId) to read\n' +
        '*(fileId: kg2_storage_abc | fileName: Chengdu China,...side A Forest | fileType: video/mp4 | fileSize: 238923776)*',
    );
  });

  it('omits the platform fragment when no sourcePlatform', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoTitle: 'Untitled',
      videoDurationSec: 60,
    });
    expect(out).toBe(
      '🎬 [Untitled] (video, 1m) — transcript indexed; call document_retrieve(fileId) to read\n' +
        '*(fileId: kg2_xyz | fileName: clip.mp4 | fileType: video/mp4 | fileSize: 1024)*',
    );
  });

  it('omits the uploader fragment when no videoUploader', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'clip.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoTitle: 'Untitled',
      sourcePlatform: 'Vimeo',
      videoDurationSec: 120,
    });
    expect(out).toBe(
      '🎬 [Untitled] (video from Vimeo, 2m) — transcript indexed; call document_retrieve(fileId) to read\n' +
        '*(fileId: kg2_xyz | fileName: clip.mp4 | fileType: video/mp4 | fileSize: 1024)*',
    );
  });

  it('falls back to fileName when videoTitle is missing', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'fallback-name.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoDurationSec: 60,
    });
    expect(out.startsWith('🎬 [fallback-name.mp4] (video,')).toBe(true);
  });

  it('formats duration as hours+minutes past 1h', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'long.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoTitle: 'Long Video',
      videoDurationSec: 3 * 3600 + 7 * 60 + 12,
    });
    expect(out).toContain('(video, 3h 7m)');
  });

  it('formats sub-1h as minutes (rounded)', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'short.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoTitle: 'Short Video',
      videoDurationSec: 89,
    });
    expect(out).toContain('(video, 1m)');
  });

  it('uses the audio icon when fileType is not video/*', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'pod.mp3',
      fileType: 'audio/mpeg',
      fileSize: 1024,
      videoTitle: 'Podcast Episode',
      videoDurationSec: 1800,
    });
    expect(out.startsWith('🎙️ [Podcast Episode]')).toBe(true);
  });

  it('strips control chars and zero-width marks from untrusted fields', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'x.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      // Newlines, NUL, and a U+200B zero-width space embedded in the
      // attacker-controlled title. Sanitization must collapse / remove
      // these before interpolation so the markdown line stays single-
      // line and the bracket boundary isn't smuggled.
      videoTitle: 'Evil\n\x00Title​ Here',
      sourcePlatform: 'YouTube‮',
      videoDurationSec: 60,
    });
    // Exactly one newline in the output (the footer separator). A
    // smuggled newline in the title would surface as a second \n.
    expect(out.split('\n').length).toBe(2);
    expect(out).toContain('[Evil Title Here]');
    expect(out).toContain('from YouTube,'); // bidi mark stripped
  });

  it('treats missing duration as 0 minutes', () => {
    const out = formatVideoLinkAttachmentMarkdown({
      fileId: 'kg2_xyz',
      fileName: 'unknown.mp4',
      fileType: 'video/mp4',
      fileSize: 1024,
      videoTitle: 'Mystery',
    });
    expect(out).toContain('(video, 0m)');
  });
});
