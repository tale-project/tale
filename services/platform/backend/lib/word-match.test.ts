import { describe, expect, test } from 'vitest';

import { wordStartPatterns } from './word-match.ts';

describe('wordStartPatterns', () => {
  test('keeps the meaningful words of a question and drops the rest', () => {
    expect(wordStartPatterns('do we have red running shoes')).toEqual([
      '\\mred',
      '\\mrunning',
      '\\mshoes',
    ]);
  });

  test('answers empty for a question that is only function words', () => {
    // The caller adds no word clause at all for this, which is why an empty
    // array must never be read as "match everything".
    expect(wordStartPatterns('what do we have?')).toEqual([]);
  });

  test('drops one-character fragments', () => {
    expect(wordStartPatterns('a b shoes')).toEqual(['\\mshoes']);
  });

  test('answers empty for an empty or blank term', () => {
    expect(wordStartPatterns('')).toEqual([]);
    expect(wordStartPatterns('   ')).toEqual([]);
  });

  test('strips German and French function words too', () => {
    expect(wordStartPatterns('welche Schuhe haben wir')).toEqual(['\\mschuhe']);
    // `avez` survives: the shared list covers French pronouns and articles but
    // not verb forms. A surplus token is harmless under an OR of word-starts,
    // and widening the list would change the 0.4 entity legs that share it.
    expect(wordStartPatterns('avez vous des chaussures rouges')).toEqual([
      '\\mavez',
      '\\mchaussures',
      '\\mrouges',
    ]);
  });

  test('treats punctuation as a word separator, never as part of a token', () => {
    // `c` then falls to the one-character rule. The phrase match still answers
    // a literal search for "c++", which is why words are added and not
    // substituted.
    expect(wordStartPatterns('c++ handbook')).toEqual(['\\mhandbook']);
    expect(wordStartPatterns('(draft) invoice')).toEqual([
      '\\mdraft',
      '\\minvoice',
    ]);
    expect(wordStartPatterns('covid-19 policy')).toEqual([
      '\\mcovid',
      '\\m19',
      '\\mpolicy',
    ]);
  });

  test('lowercases, so the pattern matches under a case-insensitive compare', () => {
    expect(wordStartPatterns('Red SHOES')).toEqual(['\\mred', '\\mshoes']);
  });
});
