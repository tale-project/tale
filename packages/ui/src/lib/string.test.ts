import { describe, expect, it } from 'vitest';

import { formatEnumLabel } from './string';

describe('formatEnumLabel', () => {
  it('title-cases a snake_case enum value', () => {
    expect(formatEnumLabel('manual_import', 'Unknown')).toBe('Manual Import');
  });

  it('falls back when the value is unset (#2643)', () => {
    expect(formatEnumLabel(undefined, 'Unknown')).toBe('Unknown');
    expect(formatEnumLabel(null, 'Unknown')).toBe('Unknown');
    expect(formatEnumLabel('', 'Unknown')).toBe('Unknown');
  });
});
