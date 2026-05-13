import { describe, expect, it } from 'vitest';

import {
  MAX_PROMPT_CATEGORY_LEN,
  MAX_PROMPT_CONTENT_BYTES,
  MAX_PROMPT_DESCRIPTION_LEN,
  MAX_PROMPT_TAGS_COUNT,
  MAX_PROMPT_TAG_LEN,
  MAX_PROMPT_TITLE_LEN,
} from './constants';
import { assertPromptSizes, normalizePromptFields } from './size_guards';

/**
 * Catch the ConvexError code thrown by assertPromptSizes. The ConvexError
 * carries `{code, field, message}` in its `data` field. Using a type guard
 * keeps the test free of `as` casts.
 */
function expectThrows(fn: () => void): { code: unknown; field: unknown } {
  try {
    fn();
  } catch (err) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'data' in err &&
      err.data !== null &&
      typeof err.data === 'object'
    ) {
      const data = err.data;
      const code = 'code' in data ? data.code : undefined;
      const field = 'field' in data ? data.field : undefined;
      return { code, field };
    }
    throw err;
  }
  throw new Error('assertion did not throw');
}

describe('assertPromptSizes — content', () => {
  it('passes on a normal-length content', () => {
    expect(() => assertPromptSizes({ content: 'hello' })).not.toThrow();
  });

  it('rejects empty content', () => {
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ content: '' }),
    );
    expect(code).toBe('empty_content');
    expect(field).toBe('content');
  });

  it('rejects whitespace-only content (defense against bypass)', () => {
    const { code } = expectThrows(() =>
      assertPromptSizes({ content: '   \n\t ' }),
    );
    expect(code).toBe('empty_content');
  });

  it('measures bytes on trimmed content (whitespace pad does not bypass)', () => {
    // Build a string whose untrimmed bytes vastly exceed the cap, but
    // trimmed bytes are 1 byte. This must NOT throw too_large; the
    // empty-content check fires first if anything.
    const padded = ' '.repeat(MAX_PROMPT_CONTENT_BYTES * 2) + 'x';
    expect(() => assertPromptSizes({ content: padded })).not.toThrow();
  });

  it('rejects when trimmed content exceeds the byte cap', () => {
    const overCap = 'a'.repeat(MAX_PROMPT_CONTENT_BYTES + 1);
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ content: overCap }),
    );
    expect(code).toBe('too_large');
    expect(field).toBe('content');
  });
});

describe('assertPromptSizes — title/description/category', () => {
  it('rejects when trimmed title exceeds the char cap', () => {
    const overCap = 'a'.repeat(MAX_PROMPT_TITLE_LEN + 1);
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ title: overCap }),
    );
    expect(code).toBe('too_large');
    expect(field).toBe('title');
  });

  it('whitespace padding cannot push title past the cap', () => {
    // ` ` * MAX + ` ` * MAX + 50 real chars. Raw .length far exceeds the
    // cap; trimmed length is 50 — must NOT throw.
    const padded =
      ' '.repeat(MAX_PROMPT_TITLE_LEN * 2) +
      'real-title' +
      ' '.repeat(MAX_PROMPT_TITLE_LEN * 2);
    expect(() => assertPromptSizes({ title: padded })).not.toThrow();
  });

  it('whitespace padding cannot push description past the cap', () => {
    const padded =
      ' '.repeat(MAX_PROMPT_DESCRIPTION_LEN * 2) + 'desc' + ' '.repeat(10);
    expect(() => assertPromptSizes({ description: padded })).not.toThrow();
  });

  it('rejects category over the cap (post-trim)', () => {
    const overCap = 'c'.repeat(MAX_PROMPT_CATEGORY_LEN + 1);
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ category: overCap }),
    );
    expect(code).toBe('too_large');
    expect(field).toBe('category');
  });
});

describe('assertPromptSizes — tags', () => {
  it('rejects more than MAX_PROMPT_TAGS_COUNT tags', () => {
    const tooMany = Array.from(
      { length: MAX_PROMPT_TAGS_COUNT + 1 },
      (_, i) => `t${i}`,
    );
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ tags: tooMany }),
    );
    expect(code).toBe('too_large');
    expect(field).toBe('tags');
  });

  it('rejects a tag whose trimmed length exceeds MAX_PROMPT_TAG_LEN', () => {
    const longTag = 'x'.repeat(MAX_PROMPT_TAG_LEN + 1);
    const { code, field } = expectThrows(() =>
      assertPromptSizes({ tags: ['ok', longTag] }),
    );
    expect(code).toBe('too_large');
    expect(field).toBe('tags');
  });

  it('whitespace-padded tag length is measured post-trim', () => {
    const padded = ' '.repeat(MAX_PROMPT_TAG_LEN * 2) + 'tag' + ' '.repeat(5);
    expect(() => assertPromptSizes({ tags: [padded] })).not.toThrow();
  });
});

describe('normalizePromptFields', () => {
  it('trims every string field', () => {
    const out = normalizePromptFields({
      title: '  hello  ',
      content: '\n\n body \n',
      description: '  d  ',
      category: '  c  ',
    });
    expect(out).toEqual({
      title: 'hello',
      content: 'body',
      description: 'd',
      category: 'c',
    });
  });

  it('drops empty/whitespace-only tags after trim', () => {
    const out = normalizePromptFields({ tags: [' a ', '   ', '', 'b'] });
    expect(out.tags).toEqual(['a', 'b']);
  });

  it('does not add fields that were not present on the input', () => {
    const out = normalizePromptFields({ title: '  t  ' });
    expect(out.title).toBe('t');
    // Keys not in input should not appear in output (no spurious empty strings).
    expect(Object.prototype.hasOwnProperty.call(out, 'content')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'description')).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(out, 'category')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, 'tags')).toBe(false);
  });
});
