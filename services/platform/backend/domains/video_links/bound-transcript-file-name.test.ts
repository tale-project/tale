import { describe, expect, it } from 'vitest';

import { chatSendAttachmentSchema } from '../chat/routes.ts';
import { boundTranscriptFileName } from './service.ts';

/** Whether the send door takes an attachment named `fileName`. */
const sendable = (fileName: string): boolean =>
  chatSendAttachmentSchema.safeParse({
    fileId: 's3:org/transcript.txt',
    fileName,
    fileType: 'video/mp4',
    fileSize: 170,
  }).success;

describe('boundTranscriptFileName', () => {
  it('names the transcript after its video', () => {
    expect(boundTranscriptFileName('Me at the zoo')).toBe('Me at the zoo');
  });

  it.each([[null], [''], ['   ']])(
    'names it "Video link" when sanitizing left no title (%j)',
    (title) => {
      // A title of zero-width or control characters alone is stored empty.
      expect(boundTranscriptFileName(title)).toBe('Video link');
    },
  );

  it('cuts a title longer than the send door takes, a whole character at a time', () => {
    // 200 characters of 11 UTF-16 code units each: within the title cap,
    // more than four times what the door takes.
    const family = '👨‍👩‍👧‍👦';
    const title = family.repeat(200);
    expect(sendable(title)).toBe(false);

    const name = boundTranscriptFileName(title);

    expect(sendable(name)).toBe(true);
    expect(name).toBe(`${family.repeat(Math.floor(511 / family.length))}…`);
  });
});
