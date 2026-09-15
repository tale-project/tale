import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDataNoticeBootMarker,
  dataNoticeBootKey,
  rememberDataNotice,
  toCssString,
} from './data-notice-boot';

afterEach(() => {
  window.localStorage.clear();
  clearDataNoticeBootMarker();
});

describe('toCssString', () => {
  it('quotes plain text as is', () => {
    expect(toCssString('Mind the data 2026')).toBe('"Mind the data 2026"');
  });

  it('escapes every character that could end or bend the string', () => {
    expect(toCssString('a"b\\c;d}')).toBe('"a\\22 b\\5c c\\3b d\\7d "');
  });

  it('escapes non-ASCII text by code point, including astral characters', () => {
    expect(toCssString('Prüfe — 🔒')).toBe('"Pr\\fc fe \\2014  \\1f512 "');
  });

  it('collapses whitespace runs, including line breaks, to one space', () => {
    expect(toCssString('  one\n\ntwo\tthree ')).toBe('"one two three"');
  });
});

describe('rememberDataNotice', () => {
  const root = document.documentElement;

  it('stores the shown text for the next load and marks <html> now', () => {
    rememberDataNotice('org-1', 'Mind the data.');

    expect(window.localStorage.getItem(dataNoticeBootKey('org-1'))).toBe(
      '"Mind the data\\2e "',
    );
    expect(root.classList.contains('boot-chat-notice')).toBe(true);
    expect(root.style.getPropertyValue('--boot-chat-notice')).toBe(
      '"Mind the data\\2e "',
    );
  });

  it('forgets the notice once it no longer shows', () => {
    rememberDataNotice('org-1', 'Mind the data.');
    rememberDataNotice('org-1', null);

    expect(window.localStorage.getItem(dataNoticeBootKey('org-1'))).toBeNull();
    expect(root.classList.contains('boot-chat-notice')).toBe(false);
    expect(root.style.getPropertyValue('--boot-chat-notice')).toBe('');
  });

  it('keeps the stored text when only the live marker is cleared', () => {
    rememberDataNotice('org-1', 'Mind the data.');
    clearDataNoticeBootMarker();

    expect(window.localStorage.getItem(dataNoticeBootKey('org-1'))).not.toBe(
      null,
    );
    expect(root.classList.contains('boot-chat-notice')).toBe(false);
  });

  it('scopes the stored text to its org', () => {
    rememberDataNotice('org-1', 'Mind the data.');

    expect(window.localStorage.getItem(dataNoticeBootKey('org-2'))).toBeNull();
  });
});
