import { describe, expect, it } from 'vitest';

import {
  escapeMentionLabel,
  formatMentionToken,
  formatMentionUrl,
  MENTION_LABEL_MAX,
  normalizeMentionLabel,
  parseMentionUrl,
} from './mention-token';

const KINDS = ['user', 'agent', 'automation'] as const;

describe('mention token', () => {
  it('writes the name and the address of whoever it names', () => {
    expect(
      formatMentionToken({
        kind: 'agent',
        id: '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40',
        label: 'My Opus Agent #3',
      }),
    ).toBe(
      '[@My Opus Agent #3](mention:agent/3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40)',
    );
    expect(
      formatMentionToken({
        kind: 'automation',
        id: 'finance/vat-return-desk',
        label: 'VAT return desk',
      }),
    ).toBe('[@VAT return desk](mention:automation/finance/vat-return-desk)');
  });

  it('escapes what would turn a name into markup, and nothing else', () => {
    expect(escapeMentionLabel("O'Brien (v2) #3")).toBe("O'Brien (v2) #3");
    expect(escapeMentionLabel('a_b *c* [d] `e` <f> & ~g~ | $h \\')).toBe(
      'a\\_b \\*c\\* \\[d\\] \\`e\\` \\<f\\> \\& \\~g\\~ \\| \\$h \\\\',
    );
  });

  it('stores a name on one line, without invisible controls, capped', () => {
    expect(normalizeMentionLabel('  Ada \n Lovelace  ')).toBe('Ada Lovelace');
    expect(normalizeMentionLabel('Ada‮ ecalevoL​')).toBe('Ada ecalevoL');
    expect(normalizeMentionLabel('x'.repeat(100))).toBe(
      `${'x'.repeat(MENTION_LABEL_MAX - 1)}…`,
    );
    // An emoji at the cut stays whole.
    expect(normalizeMentionLabel(`${'x'.repeat(62)}👩‍💻👩‍💻👩‍💻`)).toBe(
      `${'x'.repeat(62)}👩‍💻…`,
    );
    expect(formatMentionToken({ kind: 'user', id: 'u1', label: '​' })).toBe(
      '[@u1](mention:user/u1)',
    );
  });

  it('percent-encodes what an id may not carry as it is, and reads it back', () => {
    const url = formatMentionUrl({ kind: 'user', id: 'a(b)é' });
    expect(url).toBe('mention:user/a%28b%29%C3%A9');
    expect(parseMentionUrl(url, KINDS)).toEqual({ kind: 'user', id: 'a(b)é' });
    // An id never holds whitespace.
    expect(parseMentionUrl('mention:user/a%20b', KINDS)).toBeNull();
  });

  it('reads only addresses of the kinds it is given', () => {
    expect(parseMentionUrl('mention:agent/abc', KINDS)).toEqual({
      kind: 'agent',
      id: 'abc',
    });
    expect(parseMentionUrl('mention:automation/a/b', KINDS)).toEqual({
      kind: 'automation',
      id: 'a/b',
    });
    for (const url of [
      'mention:team/abc',
      'mention:agent/',
      'mention:agent',
      'mention:/abc',
      'mention:agent/%E0%A4%A',
      'https://example.com',
      `mention:user/${'x'.repeat(201)}`,
    ]) {
      expect(parseMentionUrl(url, KINDS)).toBeNull();
    }
  });
});
