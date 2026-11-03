import { describe, expect, it } from 'vitest';

import { countLines } from './count-lines';

describe('countLines', () => {
  it('counts the lines that hold something', () => {
    expect(countLines('a:1\n\nb:2\n   \nc:3\n')).toBe(3);
  });

  it('reads CRLF and lone CR line endings', () => {
    expect(countLines('a:1\r\nb:2\rc:3')).toBe(3);
  });

  it('counts nothing in an empty text', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('\n \n')).toBe(0);
  });
});
