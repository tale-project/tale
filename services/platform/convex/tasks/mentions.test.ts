import { describe, it, expect } from 'vitest';

import {
  addedMentions,
  extractMentions,
  findUnresolvedMentionTokens,
  parseMentionTokens,
  resolveMentions,
  type MentionDirectoryEntry,
} from './mentions';

const directory: MentionDirectoryEntry[] = [
  { type: 'user', id: 'user-alice', handles: ['alice', 'alice.smith'] },
  { type: 'user', id: 'user-bob', handles: ['bob'] },
  { type: 'agent', id: 'researcher', handles: ['researcher'] },
  {
    type: 'automation',
    id: 'vat-return-desk',
    handles: ['vat-return-desk', 'swiss.vat.return.desk'],
  },
];

describe('parseMentionTokens', () => {
  it('extracts tokens at the start of the string and after whitespace', () => {
    expect(parseMentionTokens('@alice hello @bob')).toEqual(['alice', 'bob']);
  });

  it('ignores email addresses (no whitespace boundary before @)', () => {
    expect(parseMentionTokens('contact me at user@example.com')).toEqual([]);
  });

  it('lowercases and de-dupes tokens preserving first-seen order', () => {
    expect(parseMentionTokens('@Bob @alice @bob')).toEqual(['bob', 'alice']);
  });

  it('returns an empty array when there are no mentions', () => {
    expect(parseMentionTokens('just some text')).toEqual([]);
  });

  it('supports dot/dash/underscore in handles', () => {
    expect(parseMentionTokens('hi @alice.smith and @re-searcher_1')).toEqual([
      'alice.smith',
      're-searcher_1',
    ]);
  });

  it('keeps pack agent slugs with slashes intact', () => {
    expect(
      parseMentionTokens('请继续 @github/create-pull-requests/pr-creator 再试'),
    ).toEqual(['github/create-pull-requests/pr-creator']);
  });
});

describe('resolveMentions', () => {
  it('resolves known handles to {type,id} refs', () => {
    expect(resolveMentions(['alice', 'researcher'], directory)).toEqual([
      { type: 'user', id: 'user-alice' },
      { type: 'agent', id: 'researcher' },
    ]);
  });

  it('resolves slash pack-agent slugs from the directory', () => {
    const withPack: MentionDirectoryEntry[] = [
      ...directory,
      {
        type: 'agent',
        id: 'github/create-pull-requests/pr-creator',
        handles: ['github/create-pull-requests/pr-creator'],
      },
    ];
    expect(
      extractMentions(
        '@github/create-pull-requests/pr-creator try again',
        withPack,
      ),
    ).toEqual([
      { type: 'agent', id: 'github/create-pull-requests/pr-creator' },
    ]);
  });

  it('drops unknown tokens', () => {
    expect(resolveMentions(['nobody', 'bob'], directory)).toEqual([
      { type: 'user', id: 'user-bob' },
    ]);
  });

  it('de-dupes when two handles map to the same actor', () => {
    expect(resolveMentions(['alice', 'alice.smith'], directory)).toEqual([
      { type: 'user', id: 'user-alice' },
    ]);
  });

  it('returns empty for no tokens', () => {
    expect(resolveMentions([], directory)).toEqual([]);
  });
});

describe('extractMentions', () => {
  it('parses and resolves in one pass', () => {
    expect(
      extractMentions('@alice please review, cc @researcher', directory),
    ).toEqual([
      { type: 'user', id: 'user-alice' },
      { type: 'agent', id: 'researcher' },
    ]);
  });
});

describe('resolveMentions (permissiveAgents)', () => {
  it("resolves unknown tokens as agent handles ('all' agent mode)", () => {
    expect(resolveMentions(['marketing-bot'], directory, true)).toEqual([
      { type: 'agent', id: 'marketing-bot' },
    ]);
  });

  it('member handles still win over the permissive agent fallback', () => {
    expect(resolveMentions(['alice', 'unknown'], directory, true)).toEqual([
      { type: 'user', id: 'user-alice' },
      { type: 'agent', id: 'unknown' },
    ]);
  });

  it('automation handles win over the permissive agent fallback', () => {
    expect(
      resolveMentions(
        ['vat-return-desk', 'swiss.vat.return.desk'],
        directory,
        true,
      ),
    ).toEqual([{ type: 'automation', id: 'vat-return-desk' }]);
  });

  it('stays strict when permissiveAgents is off', () => {
    expect(resolveMentions(['marketing-bot'], directory, false)).toEqual([]);
  });
});

describe('findUnresolvedMentionTokens', () => {
  it('returns tokens that did not resolve against the directory', () => {
    expect(
      findUnresolvedMentionTokens('@alice and @nobody', directory, false),
    ).toEqual(['nobody']);
  });

  it('returns empty when permissiveAgents treats unknowns as agents', () => {
    expect(
      findUnresolvedMentionTokens('@unknown-bot', directory, true),
    ).toEqual([]);
  });
});

describe('addedMentions', () => {
  it('returns only mentions absent from the previous set', () => {
    const previous = extractMentions('@alice owns this', directory);
    const next = extractMentions(
      '@alice owns this, @researcher dig in',
      directory,
    );
    expect(addedMentions(previous, next)).toEqual([
      { type: 'agent', id: 'researcher' },
    ]);
  });

  it('returns nothing when an edit only rewords prose around a mention', () => {
    const previous = extractMentions('@researcher dig in', directory);
    const next = extractMentions('@researcher please dig in soon', directory);
    expect(addedMentions(previous, next)).toEqual([]);
  });

  it('treats same id with different type as distinct', () => {
    expect(
      addedMentions(
        [{ type: 'user', id: 'researcher' }],
        [{ type: 'agent', id: 'researcher' }],
      ),
    ).toEqual([{ type: 'agent', id: 'researcher' }]);
  });

  it('returns everything when previous is empty (create)', () => {
    const next = extractMentions('@alice and @bob', directory);
    expect(addedMentions([], next)).toEqual(next);
  });

  // Comment edits reuse the same helper as description edits
  // (`editTaskDiscussionMessage` → `addedMentions` → `comment.mentioned`).
  it('flags an @agent added when editing a comment that had none', () => {
    const previous = extractMentions('already fixed', directory);
    const next = extractMentions(
      'already fixed @researcher try again',
      directory,
    );
    expect(addedMentions(previous, next)).toEqual([
      { type: 'agent', id: 'researcher' },
    ]);
  });
});
