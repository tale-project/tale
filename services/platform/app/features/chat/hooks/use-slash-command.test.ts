import { describe, expect, it } from 'vitest';

import {
  completeSlashCommand,
  detectSlashTrigger,
  filterSlashSkills,
} from './use-slash-command';

describe('detectSlashTrigger', () => {
  it('opens while the caret is inside a leading /token', () => {
    expect(detectSlashTrigger('/', 1)).toEqual({ query: '', end: 1 });
    expect(detectSlashTrigger('/pd', 3)).toEqual({ query: 'pd', end: 3 });
    expect(detectSlashTrigger('/write-docs', 11)).toEqual({
      query: 'write-docs',
      end: 11,
    });
  });

  it('closes the moment the command token ends', () => {
    // A space after the slug means the args have started.
    expect(detectSlashTrigger('/pdf extract', 12)).toBeNull();
    expect(detectSlashTrigger('/pdf ', 5)).toBeNull();
    // Mirrors the send grammar: nothing mid-text, nothing indented.
    expect(detectSlashTrigger('say /pdf', 8)).toBeNull();
    expect(detectSlashTrigger(' /pdf', 5)).toBeNull();
    expect(detectSlashTrigger('', 0)).toBeNull();
    expect(detectSlashTrigger('hello', 5)).toBeNull();
  });

  it('follows the caret, not just the text', () => {
    // Caret back inside the token re-opens; caret past a space stays closed.
    expect(detectSlashTrigger('/pdf', 2)).toEqual({ query: 'p', end: 2 });
    expect(detectSlashTrigger('/pdf tail', 4)).toEqual({
      query: 'pdf',
      end: 4,
    });
  });
});

describe('filterSlashSkills', () => {
  const skills = [
    { slug: 'pdf', usageMode: 'all' as const },
    { slug: 'write-docs' },
    { slug: 'agent-only', usageMode: 'agent' as const },
    { slug: 'chat-helper', usageMode: 'chat' as const },
  ];

  it('offers only chat-usable skills', () => {
    expect(
      filterSlashSkills(skills, { query: '', end: 1 }).map((s) => s.slug),
    ).toEqual(['pdf', 'write-docs', 'chat-helper']);
  });

  it('ranks prefix matches before infix matches', () => {
    expect(
      filterSlashSkills(skills, { query: 'p', end: 2 }).map((s) => s.slug),
    ).toEqual(['pdf', 'chat-helper']);
  });
});

describe('completeSlashCommand', () => {
  it('replaces the token and parks the caret after the trailing space', () => {
    expect(completeSlashCommand('/pd', { query: 'pd', end: 3 }, 'pdf')).toEqual(
      { text: '/pdf ', caret: 5 },
    );
    // Text after the caret survives a mid-token completion.
    expect(
      completeSlashCommand('/pd tail', { query: 'pd', end: 3 }, 'pdf'),
    ).toEqual({ text: '/pdf  tail', caret: 5 });
  });
});
