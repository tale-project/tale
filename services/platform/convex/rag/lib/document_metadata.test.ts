import { describe, expect, it } from 'vitest';

import {
  isValidScalar,
  MAX_METADATA_KEYS,
  MAX_METADATA_LIST_ITEMS,
  MAX_METADATA_STRING_LENGTH,
  RESERVED_METADATA_KEYS,
  sanitizeDocumentMetadata,
  validateMetadataObject,
} from './document_metadata';

describe('isValidScalar', () => {
  it('accepts strings within the length cap', () => {
    expect(isValidScalar('hello')).toBe(true);
    expect(isValidScalar('x'.repeat(MAX_METADATA_STRING_LENGTH))).toBe(true);
  });

  it('rejects over-long strings', () => {
    expect(isValidScalar('x'.repeat(MAX_METADATA_STRING_LENGTH + 1))).toBe(
      false,
    );
  });

  it('accepts numbers and booleans', () => {
    expect(isValidScalar(42)).toBe(true);
    expect(isValidScalar(true)).toBe(true);
    expect(isValidScalar(false)).toBe(true);
  });

  it('rejects objects, arrays, null, and undefined', () => {
    expect(isValidScalar({})).toBe(false);
    expect(isValidScalar([])).toBe(false);
    expect(isValidScalar(null)).toBe(false);
    expect(isValidScalar(undefined)).toBe(false);
  });
});

describe('validateMetadataObject (strict)', () => {
  it('returns the object unchanged when valid', () => {
    const meta = { category: 'legal', year: 2024, active: true };
    expect(validateMetadataObject(meta, false)).toBe(meta);
  });

  it('rejects more than the key cap', () => {
    const meta: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_METADATA_KEYS; i += 1) {
      meta[`k${i}`] = i;
    }
    expect(() => validateMetadataObject(meta, false)).toThrow(/keys/);
  });

  it('rejects reserved keys', () => {
    expect(() => validateMetadataObject({ folder_path: 'x' }, false)).toThrow(
      /reserved/,
    );
    expect(() =>
      validateMetadataObject({ content_type: 'text/plain' }, false),
    ).toThrow(/reserved/);
  });

  it('rejects an empty key', () => {
    expect(() => validateMetadataObject({ '': 'v' }, false)).toThrow(/1-/);
  });

  it('rejects a non-scalar value when lists are disallowed', () => {
    expect(() => validateMetadataObject({ tags: ['a', 'b'] }, false)).toThrow(
      /scalar/,
    );
  });

  it('admits a list of scalars when lists are allowed', () => {
    const meta = { tags: ['a', 'b', 'c'] };
    expect(validateMetadataObject(meta, true)).toBe(meta);
  });

  it('rejects an empty list even when lists are allowed', () => {
    expect(() => validateMetadataObject({ tags: [] }, true)).toThrow(/1-/);
  });

  it('rejects a list exceeding the item cap', () => {
    const tags = Array.from(
      { length: MAX_METADATA_LIST_ITEMS + 1 },
      (_, i) => `t${i}`,
    );
    expect(() => validateMetadataObject({ tags }, true)).toThrow(/items/);
  });

  it('rejects a list containing a non-scalar', () => {
    expect(() => validateMetadataObject({ tags: ['a', {}] }, true)).toThrow(
      /scalars/,
    );
  });

  it('rejects a non-scalar value', () => {
    expect(() =>
      validateMetadataObject({ obj: { nested: true } }, false),
    ).toThrow(/string, number, or boolean/);
  });
});

describe('sanitizeDocumentMetadata (lenient)', () => {
  it('keeps valid scalar entries', () => {
    expect(sanitizeDocumentMetadata({ category: 'legal', year: 2024 })).toEqual(
      { category: 'legal', year: 2024 },
    );
  });

  it('silently drops reserved keys', () => {
    const result = sanitizeDocumentMetadata({
      folder_path: 'a/b',
      content_type: 'text/plain',
      file_id: 'x',
      keep: 'me',
    });
    expect(result).toEqual({ keep: 'me' });
  });

  it('drops non-scalar values without throwing', () => {
    const result = sanitizeDocumentMetadata({
      good: 'value',
      bad: { nested: true },
      list: [1, 2, 3],
    });
    expect(result).toEqual({ good: 'value' });
  });

  it('drops over-long keys', () => {
    const longKey = 'k'.repeat(100);
    const result = sanitizeDocumentMetadata({ [longKey]: 'v', ok: 'v' });
    expect(result).toEqual({ ok: 'v' });
  });

  it('caps the number of stored keys', () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < MAX_METADATA_KEYS + 5; i += 1) {
      input[`k${i}`] = i;
    }
    const result = sanitizeDocumentMetadata(input);
    expect(Object.keys(result)).toHaveLength(MAX_METADATA_KEYS);
  });

  it('never throws on arbitrary input', () => {
    expect(() => sanitizeDocumentMetadata({})).not.toThrow();
  });
});

describe('RESERVED_METADATA_KEYS', () => {
  it('contains the transport/column keys', () => {
    for (const key of [
      'source_created_at',
      'source_modified_at',
      'folder_path',
      'content_type',
      'file_id',
      'filename',
    ]) {
      expect(RESERVED_METADATA_KEYS.has(key)).toBe(true);
    }
  });
});
