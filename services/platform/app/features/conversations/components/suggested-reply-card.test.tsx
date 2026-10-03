import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { SuggestedReplyCard } from './suggested-reply-card';

/**
 * An automation's drafted reply is a labelled region beside the composer with
 * the two decisions a person can take — never text typed into the composer
 * on their behalf. Once taken into the editor, the region gives way to one
 * status line, so the composer's content reads as the person's own.
 */

const BODY = 'Hi Larry,\n\nThanks for the update.\n\nBest regards';

describe('SuggestedReplyCard', () => {
  it('names itself, shows the proposal and offers both decisions', async () => {
    const onUse = vi.fn();
    const onDiscard = vi.fn();
    render(
      <SuggestedReplyCard
        body={BODY}
        used={false}
        discarding={false}
        onUse={onUse}
        onDiscard={onDiscard}
      />,
    );

    const region = await screen.findByRole('region', {
      name: 'Suggested reply',
    });
    expect(region).toHaveTextContent('Thanks for the update.');
    expect(region).toHaveTextContent('nothing has been sent');

    screen.getByRole('button', { name: 'Put in editor' }).click();
    expect(onUse).toHaveBeenCalledOnce();
    screen.getByRole('button', { name: 'Discard' }).click();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it('holds the decisions while a discard is in flight', async () => {
    render(
      <SuggestedReplyCard
        body={BODY}
        used={false}
        discarding
        onUse={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole('button', { name: 'Put in editor' }),
    ).toBeDisabled();
  });

  it('becomes a status line once the proposal is in the editor', async () => {
    render(
      <SuggestedReplyCard
        body={BODY}
        used
        discarding={false}
        onUse={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The suggestion is in the editor.',
    );
    expect(
      screen.queryByRole('region', { name: 'Suggested reply' }),
    ).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
