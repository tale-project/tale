import { describe, expect, it } from 'vitest';

import {
  INDEXED_MESSAGE_CHANNEL,
  INDEXED_MESSAGE_DIRECTION,
  isIndexedMessage,
  isMessageId,
  isMessageRef,
  MESSAGE_REF_LIKE_PATTERN,
  messageRef,
  parseMessageRef,
} from './message-ref';

const MESSAGE_ID = '0b1f9c6e-5d2a-4c1e-9a77-3f0e2b8d4c11';

describe('message refs', () => {
  it('round-trips a message id through its ref', () => {
    const ref = messageRef(MESSAGE_ID);
    expect(ref).toBe(`msg:${MESSAGE_ID}`);
    expect(isMessageRef(ref)).toBe(true);
    expect(parseMessageRef(ref)).toBe(MESSAGE_ID);
  });

  it('never reads a blob ref as a message', () => {
    for (const ref of ['s3:acme/uploads/cv.pdf', 'kg2abc123', 'https://x']) {
      expect(isMessageRef(ref)).toBe(false);
      expect(parseMessageRef(ref)).toBeNull();
    }
  });

  it('names no message for a malformed ref, while still calling it a message ref', () => {
    // A model can quote a ref back to rag_fetch; a mangled one must deny as
    // a message and never fall through to a blob path.
    for (const ref of [
      'msg:',
      'msg: 123',
      'msg:a/b',
      'msg:%',
      `msg:${'a'.repeat(129)}`,
    ]) {
      expect(isMessageRef(ref)).toBe(true);
      expect(parseMessageRef(ref)).toBeNull();
    }
  });

  it('refuses to mint a ref for an id no message row carries', () => {
    expect(() => messageRef('')).toThrow();
    expect(() => messageRef('a b')).toThrow();
    expect(isMessageId('')).toBe(false);
    expect(isMessageId(MESSAGE_ID)).toBe(true);
    // Convex-era ids (letters and digits) are ids too.
    expect(isMessageId('jd7f8k2m4n6p8r0t')).toBe(true);
  });

  it('matches every message ref with a LIKE pattern that holds no other metacharacter', () => {
    expect(MESSAGE_REF_LIKE_PATTERN).toBe('msg:%');
    expect(MESSAGE_REF_LIKE_PATTERN.slice(0, -1)).not.toMatch(/[%_\\]/);
  });
});

describe('isIndexedMessage', () => {
  it('holds inbound email only', () => {
    expect(INDEXED_MESSAGE_DIRECTION).toBe('inbound');
    expect(INDEXED_MESSAGE_CHANNEL).toBe('email');
    expect(isIndexedMessage({ direction: 'inbound', channel: 'email' })).toBe(
      true,
    );
  });

  it('leaves our own replies and mirrored conversations out', () => {
    expect(isIndexedMessage({ direction: 'outbound', channel: 'email' })).toBe(
      false,
    );
    expect(isIndexedMessage({ direction: 'inbound', channel: 'api' })).toBe(
      false,
    );
    expect(isIndexedMessage({ direction: 'inbound', channel: null })).toBe(
      false,
    );
  });
});
