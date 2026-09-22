import { describe, expect, it } from 'vitest';

import { readApiKey } from './api-key';

describe('readApiKey', () => {
  it('reads a bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer the-key' });
    expect(readApiKey(headers)).toBe('the-key');
  });

  it('accepts any casing of the bearer scheme', () => {
    const headers = new Headers({ authorization: 'bearer the-key' });
    expect(readApiKey(headers)).toBe('the-key');
  });

  it('reads the x-api-key header', () => {
    expect(readApiKey(new Headers({ 'x-api-key': 'the-key' }))).toBe('the-key');
  });

  it('answers null when neither header carries a value', () => {
    expect(readApiKey(new Headers())).toBeNull();
    expect(readApiKey(new Headers({ authorization: 'Bearer ' }))).toBeNull();
    expect(readApiKey(new Headers({ authorization: 'Basic abc' }))).toBeNull();
  });
});
