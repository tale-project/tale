import { describe, expect, it } from 'vitest';

import { normalizeEscapeSequences } from './document_action';

describe('normalizeEscapeSequences', () => {
  it('converts literal \\n to actual newlines', () => {
    expect(normalizeEscapeSequences('hello\\nworld')).toBe('hello\nworld');
  });

  it('converts literal \\t to actual tabs', () => {
    expect(normalizeEscapeSequences('col1\\tcol2')).toBe('col1\tcol2');
  });

  it('handles multiple occurrences', () => {
    expect(normalizeEscapeSequences('a\\n\\nb\\n\\nc')).toBe('a\n\nb\n\nc');
  });

  it('preserves escaped backslash before n (\\\\n)', () => {
    expect(normalizeEscapeSequences('C:\\\\new_folder')).toBe(
      'C:\\\\new_folder',
    );
  });

  it('does not modify actual newlines', () => {
    expect(normalizeEscapeSequences('hello\nworld')).toBe('hello\nworld');
  });

  it('handles mixed actual and literal newlines', () => {
    expect(normalizeEscapeSequences('line1\nline2\\nline3')).toBe(
      'line1\nline2\nline3',
    );
  });

  it('handles markdown with literal escape sequences', () => {
    const input = '## Document.docx\\n\\n---\\n\\n### Section Title';
    const expected = '## Document.docx\n\n---\n\n### Section Title';
    expect(normalizeEscapeSequences(input)).toBe(expected);
  });

  it('returns empty string unchanged', () => {
    expect(normalizeEscapeSequences('')).toBe('');
  });
});
