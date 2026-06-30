import { describe, expect, it } from 'vitest';

import { describeDiscussionAuthor } from './resolve-author';

// Stub mirroring useActorDirectory.resolveActor: a resolved display name for
// known ids, and the id echoed back on a miss (how the helper detects unknown).
const directory = {
  users: { 'user-me': 'Me', 'user-alex': 'Alex' } as Record<string, string>,
  agents: { researcher: 'Researcher' } as Record<string, string>,
};
const resolveActor = (type: 'user' | 'agent', id: string) => ({
  name:
    type === 'user'
      ? (directory.users[id] ?? id)
      : (directory.agents[id] ?? id),
});

describe('describeDiscussionAuthor', () => {
  it('returns empty for an unattributed (legacy) message', () => {
    expect(
      describeDiscussionAuthor(undefined, 'user-me', resolveActor),
    ).toEqual({});
  });

  it('marks the current user as own, with no name label', () => {
    expect(
      describeDiscussionAuthor('user-me', 'user-me', resolveActor),
    ).toEqual({ isOwn: true });
  });

  it('resolves a teammate to a left-aligned, named entry', () => {
    expect(
      describeDiscussionAuthor('user-alex', 'user-me', resolveActor),
    ).toEqual({ isOwn: false, authorName: 'Alex' });
  });

  it('resolves an agent slug to a left-aligned, named entry', () => {
    expect(
      describeDiscussionAuthor('researcher', 'user-me', resolveActor),
    ).toEqual({ isOwn: false, authorName: 'Researcher' });
  });

  it('left-aligns an unresolved author with no label', () => {
    expect(describeDiscussionAuthor('ghost', 'user-me', resolveActor)).toEqual({
      isOwn: false,
    });
  });

  it('treats a present author as not-own when there is no current user', () => {
    expect(
      describeDiscussionAuthor('user-alex', undefined, resolveActor),
    ).toEqual({ isOwn: false, authorName: 'Alex' });
  });
});
