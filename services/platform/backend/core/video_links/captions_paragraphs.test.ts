import { describe, expect, it } from 'vitest';

import {
  CAPTION_PROFILE,
  joinSegmentsWithParagraphs,
  WHISPER_PROFILE,
} from '../file_metadata/paragraphize';
import {
  captionsToParagraphSegments,
  parseVtt,
  rollingWindowDedup,
  type CaptionSegment,
} from './captions_parser';

function paragraphize(segments: CaptionSegment[]): string {
  return joinSegmentsWithParagraphs(
    captionsToParagraphSegments(rollingWindowDedup(segments)),
    '',
    { profile: CAPTION_PROFILE, addTimestamps: true },
  );
}

function cues(texts: string[]): CaptionSegment[] {
  return parseVtt(
    'WEBVTT\n\n' +
      texts
        .map(
          (text, index) =>
            `00:00:${String(index * 2).padStart(2, '0')}.000 --> ` +
            `00:00:${String(index * 2 + 2).padStart(2, '0')}.000\n${text}`,
        )
        .join('\n\n'),
  );
}

describe('caption-only paragraph boundaries', () => {
  it.each([
    [
      ['We will', 'ship Monday.', 'Thank you.'],
      'We will ship Monday. Thank you.',
    ],
    [['One intact cue.'], 'One intact cue.'],
    [['Hello', ',', 'world', '!'], 'Hello, world!'],
    [['Wait...', 'What?'], 'Wait... What?'],
    [['(', 'hello', ')', 'world.'], '(hello) world.'],
    [['“', 'Hello', '”', 'world.'], '“Hello” world.'],
    [["'Hello'", 'world.'], "'Hello' world."],
    [['‘Hello’', 'world.'], '‘Hello’ world.'],
    [["'Hello there'", 'world.'], "'Hello there' world."],
    [['‘Hello there’', 'world.'], '‘Hello there’ world.'],
    [['Say', "'hello'."], "Say 'hello'."],
    [['Say "', 'hello".'], 'Say "hello".'],
    [['Cafe', '\u0301.'], 'Cafe\u0301.'],
    [['We', "'re ready."], "We're ready."],
    [["We'", 're ready.'], "We're ready."],
    [["O'", 'Brien is ready.'], "O'Brien is ready."],
    [['O’', 'Brien is ready.'], 'O’Brien is ready.'],
    [["We called O'", 'Brien.'], "We called O'Brien."],
    [["l'", 'homme arrive.'], "l'homme arrive."],
    [['We aren', '’t ready.'], 'We aren’t ready.'],
    [['state-', 'of-the-art.'], 'state-of-the-art.'],
    [['state', '-of-the-art.'], 'state-of-the-art.'],
    [['こんにちは', '世界。', 'ありがとう。'], 'こんにちは世界。ありがとう。'],
    [['我们', '周一发货。', '谢谢。'], '我们周一发货。谢谢。'],
    [['วันนี้', 'อากาศดี'], 'วันนี้อากาศดี'],
    [['ສະບາຍ', 'ດີ'], 'ສະບາຍດີ'],
    [['សួស្តី', 'ពិភពលោក'], 'សួស្តីពិភពលោក'],
    [['မင်္ဂလာ', 'ပါ'], 'မင်္ဂလာပါ'],
    [['今日はMonday.', 'Thank you.'], '今日はMonday. Thank you.'],
    [['ありがとう。', 'Thank you.'], 'ありがとう。Thank you.'],
    [['Привет', 'мир.'], 'Привет мир.'],
    [['مرحبا', 'بالعالم.'], 'مرحبا بالعالم.'],
  ])('joins %j as %s', (texts, expected) => {
    expect(paragraphize(cues(texts))).toBe(`[00:00:00] ${expected}`);
  });

  it('retains existing whitespace in adapter input without doubling it', () => {
    const segments = [
      { startSec: 0, endSec: 2, text: 'Hello ' },
      { startSec: 2, endSec: 4, text: 'world.' },
      { startSec: 4, endSec: 6, text: ' Thank you.' },
    ];
    expect(captionsToParagraphSegments(segments)).toEqual(segments);
    expect(paragraphize(segments)).toBe('[00:00:00] Hello world. Thank you.');
  });

  it('breaks at a pause without leaving a leading separator', () => {
    expect(
      paragraphize([
        { startSec: 0, endSec: 2, text: 'Hello.' },
        { startSec: 3, endSec: 4, text: 'Thank you.' },
      ]),
    ).toBe('[00:00:00] Hello.\n\n[00:00:03] Thank you.');
  });

  it('keeps speaker transitions including unlabeled cues', () => {
    expect(
      paragraphize([
        { startSec: 0, endSec: 2, text: 'Hello.', speaker: 'Alice' },
        { startSec: 2, endSec: 4, text: 'Thank you.' },
        { startSec: 4, endSec: 6, text: 'Goodbye.', speaker: 'Bob' },
      ]),
    ).toBe(
      '[00:00:00] Alice: Hello.\n\n[00:00:02] Thank you.\n\n[00:00:04] Bob: Goodbye.',
    );
  });

  it('retains duration-based paragraph breaks', () => {
    expect(
      paragraphize([
        { startSec: 0, endSec: 20, text: 'First sentence.' },
        { startSec: 20, endSec: 31, text: 'Next sentence.' },
      ]),
    ).toBe('[00:00:00] First sentence.\n\n[00:00:20] Next sentence.');
  });

  it('does not change Whisper leading spaces or token splits', () => {
    const segments = [
      { startSec: 0, endSec: 1, text: ' We will' },
      { startSec: 1, endSec: 2, text: ' ship Monday.' },
      { startSec: 2, endSec: 3, text: ' Trans' },
      { startSec: 3, endSec: 4, text: 'cription works.' },
    ];
    expect(
      joinSegmentsWithParagraphs(segments, '', { profile: WHISPER_PROFILE }),
    ).toBe('We will ship Monday. Transcription works.');
    expect(
      joinSegmentsWithParagraphs(segments, '', {
        profile: WHISPER_PROFILE,
        addTimestamps: true,
      }),
    ).toBe('[00:00:00] We will ship Monday. Transcription works.');
  });
});
