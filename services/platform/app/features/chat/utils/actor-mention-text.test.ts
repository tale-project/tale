import { describe, expect, it } from 'vitest';

import type { MentionActorOption } from '../../tasks/lib/mention-actor-options';
import { findMentionedActors, stripActorMention } from './actor-mention-text';

const alice: MentionActorOption = {
  type: 'user',
  id: 'user-1',
  name: 'Alice Smith',
  email: 'alice@example.com',
  handle: 'alice',
};

const bot: MentionActorOption = {
  type: 'agent',
  id: 'helper-bot',
  name: 'Helper Bot',
  handle: 'helper-bot',
};

const options = [alice, bot];

describe('findMentionedActors', () => {
  it('finds actors mentioned by their insert handle', () => {
    expect(findMentionedActors('ask @alice and @helper-bot', options)).toEqual([
      alice,
      bot,
    ]);
  });

  it('resolves every server handle variant, like the backend does', () => {
    // dotted name, squashed name, and userId all resolve to Alice.
    expect(findMentionedActors('cc @alice.smith', options)).toEqual([alice]);
    expect(findMentionedActors('cc @alicesmith', options)).toEqual([alice]);
    expect(findMentionedActors('cc @user-1', options)).toEqual([alice]);
  });

  it('dedupes repeated mentions of the same actor', () => {
    expect(findMentionedActors('@alice hey @alice.smith', options)).toEqual([
      alice,
    ]);
  });

  it('ignores email addresses and unknown tokens', () => {
    expect(findMentionedActors('mail alice@example.com', options)).toEqual([]);
    expect(findMentionedActors('@nobody-here', options)).toEqual([]);
  });

  it('does not match a handle embedded in a longer token', () => {
    // `@alicerocks` is one token the server would not resolve to Alice.
    expect(findMentionedActors('@alicerocks', options)).toEqual([]);
  });
});

describe('stripActorMention', () => {
  it('removes the mention and its trailing space', () => {
    expect(stripActorMention('ask @alice about it', alice)).toBe(
      'ask about it',
    );
  });

  it('removes every variant and every occurrence', () => {
    expect(stripActorMention('@alice then @alice.smith again', alice)).toBe(
      'then again',
    );
  });

  it('leaves other mentions and email addresses untouched', () => {
    expect(
      stripActorMention('@alice mail alice@example.com @helper-bot', alice),
    ).toBe('mail alice@example.com @helper-bot');
  });

  it('does not clip longer tokens that share a prefix', () => {
    expect(stripActorMention('@alicerocks', alice)).toBe('@alicerocks');
  });
});
