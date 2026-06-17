// The stdin NDJSON line contract: a malformed line kills the CLI's
// stream-json reader (verified 2.1.173), so every producer must emit exactly
// one newline-terminated valid-JSON line.

import { describe, expect, it } from 'vitest';

import {
  buildSteerStdinPayload,
  buildStdinUserMessage,
  STEER_STDIN_TEXT_CAP,
  truncateToUtf8Bytes,
} from './stdin';

describe('buildStdinUserMessage', () => {
  it('emits one newline-terminated stream-json user line', () => {
    const line = buildStdinUserMessage('hello\nworld');
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello\nworld' }],
      },
    });
  });
});

describe('buildSteerStdinPayload', () => {
  it('wraps a batch in the TALE_STEER sentinel the platform parser matches', () => {
    const line = buildSteerStdinPayload([
      { messageId: 'm1', text: 'first' },
      { messageId: 'm2', text: 'second' },
    ]);
    const parsed = JSON.parse(line);
    const text: string = parsed.message.content[0].text;
    expect(text).toContain('[TALE_STEER ids=m1,m2]');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  it('caps the payload at the hook-mirrored text cap', () => {
    const line = buildSteerStdinPayload([
      { messageId: 'm1', text: 'x'.repeat(64 * 1024) },
    ]);
    const parsed = JSON.parse(line);
    expect(parsed.message.content[0].text.length).toBeLessThanOrEqual(
      STEER_STDIN_TEXT_CAP,
    );
    expect(line.slice(0, -1)).not.toContain('\n');
  });

  it('caps a multibyte batch by BYTES without splitting a codepoint', () => {
    const line = buildSteerStdinPayload([
      { messageId: 'm1', text: '🙂'.repeat(64 * 1024) },
    ]);
    const text: string = JSON.parse(line).message.content[0].text;
    // The byte length — not the char length — must stay within the cap, so the
    // decoded NDJSON line can never exceed RUNNERD_STDIN_MAX_BYTES.
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(
      STEER_STDIN_TEXT_CAP,
    );
    // A mid-emoji cut would surface as the U+FFFD replacement char.
    expect(text).not.toContain('�');
    expect(line.slice(0, -1)).not.toContain('\n');
  });
});

describe('truncateToUtf8Bytes', () => {
  it('returns the input unchanged when within the byte budget', () => {
    expect(truncateToUtf8Bytes('héllo', 100)).toBe('héllo');
  });

  it('truncates on a codepoint boundary, never mid-sequence', () => {
    // '🙂' is 4 UTF-8 bytes; a 10-byte budget fits two whole emoji (8 bytes)
    // and must drop the partial third rather than emit half its bytes.
    const out = truncateToUtf8Bytes('🙂'.repeat(5), 10);
    expect(out).toBe('🙂🙂');
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(10);
    expect(out).not.toContain('�');
  });
});
