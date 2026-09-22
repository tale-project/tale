import { describe, expect, it } from 'vitest';

import { buildImprovePrompt, IMPROVE_MAX_INPUT_CHARS } from './improve.ts';

// The composer's Improve with AI used to answer, client-side, "Message
// improvement is offline while the platform AI backend is rewritten" — an
// entry a person could enter and submit but never complete (CONV-F8). The
// lane is one bounded direct call; its prompt is what this locks.
describe('buildImprovePrompt', () => {
  it('sends the rules, then the draft, with the instruction ahead of it', () => {
    const messages = buildImprovePrompt({
      originalMessage: 'Hi,\n\nthanks for writing.',
      instruction: 'make it warmer',
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'system' });
    expect(messages[0]?.content).toContain('Keep every fact');
    expect(messages[1]?.content).toBe(
      'Instruction: make it warmer\n\nDraft:\n\nHi,\n\nthanks for writing.',
    );
  });

  it('omits the instruction line when none was given', () => {
    expect(buildImprovePrompt({ originalMessage: 'x' })[1]?.content).toBe(
      'Draft:\n\nx',
    );
    expect(
      buildImprovePrompt({ originalMessage: 'x', instruction: '   ' })[1]
        ?.content,
    ).toBe('Draft:\n\nx');
  });

  it('bounds the draft it forwards', () => {
    const content = buildImprovePrompt({
      originalMessage: 'y'.repeat(IMPROVE_MAX_INPUT_CHARS + 500),
    })[1]?.content;
    expect(content?.length).toBe('Draft:\n\n'.length + IMPROVE_MAX_INPUT_CHARS);
  });
});
