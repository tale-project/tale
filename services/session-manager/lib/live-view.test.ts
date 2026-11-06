import { describe, expect, it } from 'vitest';

import {
  MAX_TAB_TITLE,
  MAX_TAB_URL,
  MAX_TEXT,
  NOTICE_CODES,
  clampText,
  clientMessageSchema,
  serverMessageSchema,
} from './live-view.ts';

describe('an error message of the server', () => {
  it('can say that the connection is refused, with a code the page stops trying on', () => {
    expect(
      serverMessageSchema.parse({
        t: 'error',
        code: 'session_not_running',
        message: 'Session a is not running.',
      }),
    ).toEqual({
      t: 'error',
      code: 'session_not_running',
      message: 'Session a is not running.',
    });
  });

  it('can say that one action failed and the connection goes on, with a notice the page words', () => {
    for (const notice of NOTICE_CODES) {
      expect(
        serverMessageSchema.parse({ t: 'error', message: 'No.', notice }),
      ).toEqual({ t: 'error', message: 'No.', notice });
    }
  });

  it('needs no notice: an error of the older kind still reads', () => {
    expect(
      serverMessageSchema.parse({
        t: 'error',
        message: 'There is no such tab.',
      }),
    ).toEqual({ t: 'error', message: 'There is no such tab.' });
  });

  it('refuses a notice that nothing in the page can word', () => {
    expect(
      serverMessageSchema.safeParse({
        t: 'error',
        message: 'No.',
        notice: 'something_new',
      }).success,
    ).toBe(false);
  });

  it('knows the notices the browser layer can raise', () => {
    expect(NOTICE_CODES).toEqual([
      'address_refused',
      'tab_gone',
      'tab_not_opened',
      'key_failed',
      'input_stuck',
      'action_failed',
    ]);
  });
});

describe('clampText', () => {
  it('leaves a text that fits as it is', () => {
    expect(clampText('hello')).toBe('hello');
    expect(clampText('a'.repeat(MAX_TEXT))).toBe('a'.repeat(MAX_TEXT));
  });

  it('keeps the beginning of a text that is too long', () => {
    expect(clampText(`${'a'.repeat(MAX_TEXT)}rest`)).toBe('a'.repeat(MAX_TEXT));
  });

  it('does not cut a character in two', () => {
    const cut = clampText(`${'b'.repeat(MAX_TEXT - 1)}😀 and the rest`);
    expect(cut).toBe('b'.repeat(MAX_TEXT - 1));
    expect(cut.isWellFormed()).toBe(true);
  });

  it('keeps a character that ends exactly at the limit', () => {
    const text = `${'c'.repeat(MAX_TEXT - 2)}😀rest`;
    expect(clampText(text)).toBe(`${'c'.repeat(MAX_TEXT - 2)}😀`);
  });

  it('gives a text that clampText made the protocol accepts', () => {
    const text = clampText('x'.repeat(MAX_TEXT * 3));
    expect(clientMessageSchema.safeParse({ t: 'text', text }).success).toBe(
      true,
    );
  });
});

describe('the tabs message', () => {
  it('carries an address of at most 2,048 characters and a title of at most 512', () => {
    // The README says so; the server cuts what a page makes longer.
    expect([MAX_TAB_URL, MAX_TAB_TITLE]).toEqual([2048, 512]);
  });
});
