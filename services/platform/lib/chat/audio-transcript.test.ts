import { describe, expect, it } from 'vitest';

import { buildAudioTranscriptAppendix } from './audio-transcript';

describe('buildAudioTranscriptAppendix', () => {
  it('returns empty string when nothing is staged', () => {
    expect(buildAudioTranscriptAppendix([])).toBe('');
  });

  it('formats a completed transcript with duration', () => {
    expect(
      buildAudioTranscriptAppendix([
        {
          fileName: 'meeting.mp3',
          status: 'completed',
          transcript: 'Hello world',
          durationSec: 12.34,
        },
      ]),
    ).toBe(
      '\n\n---\n**Audio transcript: meeting.mp3** (12.3s)\n\nHello world\n---\n',
    );
  });

  it('omits the duration note when duration is absent', () => {
    expect(
      buildAudioTranscriptAppendix([
        {
          fileName: 'clip.wav',
          status: 'completed',
          transcript: 'hi',
        },
      ]),
    ).toBe('\n\n---\n**Audio transcript: clip.wav**\n\nhi\n---\n');
  });

  it('marks skipped and failed rows without inventing a transcript', () => {
    expect(
      buildAudioTranscriptAppendix([
        { fileName: 'a.mp3', status: 'skipped' },
        {
          fileName: 'b.mp3',
          status: 'failed',
          error: 'provider down',
        },
        { fileName: 'c.mp3', status: 'running' },
      ]),
    ).toBe(
      '\n\n[Audio file "a.mp3" could not be transcribed: skipped]\n' +
        '\n\n[Audio file "b.mp3" could not be transcribed: provider down]\n' +
        '\n\n[Audio file "c.mp3" could not be transcribed: transcription incomplete]\n',
    );
  });

  it('treats a completed row with an empty transcript as incomplete', () => {
    expect(
      buildAudioTranscriptAppendix([
        { fileName: 'empty.mp3', status: 'completed', transcript: '' },
      ]),
    ).toBe(
      '\n\n[Audio file "empty.mp3" could not be transcribed: transcription incomplete]\n',
    );
  });
});
