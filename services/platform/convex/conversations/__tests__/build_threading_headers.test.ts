import { describe, it, expect } from 'vitest';

import { buildThreadingHeaders } from '../build_threading_headers';

describe('buildThreadingHeaders', () => {
  it('should use caller-provided inReplyTo and references when given', () => {
    const result = buildThreadingHeaders({
      inReplyTo: '<provided@example.com>',
      references: ['<root@example.com>', '<provided@example.com>'],
      latestMessageExternalId: '<latest@example.com>',
      conversationExternalMessageId: '<root@example.com>',
    });

    expect(result.inReplyTo).toBe('<provided@example.com>');
    expect(result.references).toEqual([
      '<root@example.com>',
      '<provided@example.com>',
    ]);
  });

  it('should resolve inReplyTo from latest message when not provided', () => {
    const result = buildThreadingHeaders({
      latestMessageExternalId: '<latest@example.com>',
      conversationExternalMessageId: '<root@example.com>',
    });

    expect(result.inReplyTo).toBe('<latest@example.com>');
    expect(result.references).toEqual([
      '<root@example.com>',
      '<latest@example.com>',
    ]);
  });

  it('should fall back to conversation externalMessageId when no latest message', () => {
    const result = buildThreadingHeaders({
      conversationExternalMessageId: '<root@example.com>',
    });

    expect(result.inReplyTo).toBe('<root@example.com>');
    expect(result.references).toEqual(['<root@example.com>']);
  });

  it('should deduplicate when latest message ID equals root ID', () => {
    const result = buildThreadingHeaders({
      latestMessageExternalId: '<root@example.com>',
      conversationExternalMessageId: '<root@example.com>',
    });

    expect(result.inReplyTo).toBe('<root@example.com>');
    expect(result.references).toEqual(['<root@example.com>']);
  });

  it('should return undefined fields when no IDs are available', () => {
    const result = buildThreadingHeaders({});

    expect(result.inReplyTo).toBeUndefined();
    expect(result.references).toBeUndefined();
  });

  it('should build references from root + inReplyTo when root differs', () => {
    const result = buildThreadingHeaders({
      latestMessageExternalId: '<reply-3@example.com>',
      conversationExternalMessageId: '<original@example.com>',
    });

    expect(result.inReplyTo).toBe('<reply-3@example.com>');
    expect(result.references).toEqual([
      '<original@example.com>',
      '<reply-3@example.com>',
    ]);
  });

  it('should not override provided references even when inReplyTo is auto-resolved', () => {
    const result = buildThreadingHeaders({
      references: ['<custom-ref@example.com>'],
      latestMessageExternalId: '<latest@example.com>',
      conversationExternalMessageId: '<root@example.com>',
    });

    expect(result.inReplyTo).toBe('<latest@example.com>');
    expect(result.references).toEqual(['<custom-ref@example.com>']);
  });
});
