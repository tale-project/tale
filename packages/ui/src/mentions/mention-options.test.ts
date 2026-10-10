import { describe, expect, it } from 'vitest';

import { filterMentionOptions, type MentionOption } from './mention-options';

const options: MentionOption[] = [
  {
    kind: 'user',
    id: 'u1',
    name: 'Ada Lovelace',
    keywords: ['ada', 'ada@example.com'],
  },
  {
    kind: 'agent',
    id: 'a1',
    name: 'My Opus Agent #3',
    keywords: ['my-opus-agent-3'],
  },
  {
    kind: 'agent',
    id: 'a2',
    name: 'My Opus Agent 3',
    keywords: ['my-opus-agent-3-02'],
  },
  { kind: 'automation', id: 'vat-desk', name: 'VAT desk', keywords: [] },
];

const ids = (found: MentionOption[]) => found.map((option) => option.id);

describe('filterMentionOptions', () => {
  it('lists everyone for an empty query, up to the cap', () => {
    expect(ids(filterMentionOptions(options, ''))).toEqual([
      'u1',
      'a1',
      'a2',
      'vat-desk',
    ]);
    expect(filterMentionOptions(options, '', 2)).toHaveLength(2);
  });

  it('finds by name, by a word of the name and by a keyword', () => {
    expect(ids(filterMentionOptions(options, 'love'))).toEqual(['u1']);
    expect(ids(filterMentionOptions(options, 'example.com'))).toEqual(['u1']);
    expect(ids(filterMentionOptions(options, 'my-opus-agent-3-0'))).toEqual([
      'a2',
    ]);
  });

  it('finds a name across its spaces, and the handle that spells it', () => {
    expect(ids(filterMentionOptions(options, 'my opus'))).toEqual(['a1', 'a2']);
    expect(ids(filterMentionOptions(options, 'My  Opus Agent '))).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('puts what starts with the query above what only contains it', () => {
    expect(ids(filterMentionOptions(options, 'a'))).toEqual([
      'u1',
      'a1',
      'a2',
      'vat-desk',
    ]);
    expect(ids(filterMentionOptions(options, 'desk'))).toEqual(['vat-desk']);
    expect(ids(filterMentionOptions(options, 'esk'))).toEqual(['vat-desk']);
  });
});
