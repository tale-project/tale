import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { RunAskCard } from './run-ask-card';

// The answer mutation, observable: the card must record the answer AFTER the
// timeline mirror (post-then-resume, so the resumed agent can already read
// the thread) and must refuse an empty submission outright.
const { mutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue(null),
}));
vi.mock('../hooks/mutations', () => ({
  useAnswerHumanAsk: () => ({ mutateAsync }),
}));

const ask = {
  askId: 'ask-1' as Id<'automationHumanAsks'>,
  question: 'RE-2026-0120: which amount governs — 1850.00 or 1580.00?',
};

describe('RunAskCard', () => {
  it('shows the question and submits the answer, mirror first', async () => {
    const calls: string[] = [];
    mutateAsync.mockImplementation(() => {
      calls.push('answer');
      return Promise.resolve(null);
    });
    const onAnswerPosted = vi.fn((_answer: string) => {
      calls.push('mirror');
      return Promise.resolve();
    });
    render(
      <RunAskCard
        organizationId="org-1"
        ask={ask}
        onAnswerPosted={onAnswerPosted}
      />,
    );
    expect(screen.getByTestId('run-ask-question')).toHaveTextContent(
      'which amount governs',
    );

    fireEvent.change(screen.getByLabelText(/your answer/i), {
      target: { value: 'The invoice copy: 1580.00 net.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /send answer & resume/i }),
    );

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        askId: ask.askId,
        answer: 'The invoice copy: 1580.00 net.',
      });
    });
    expect(onAnswerPosted).toHaveBeenCalledWith(
      'The invoice copy: 1580.00 net.',
    );
    expect(calls).toEqual(['mirror', 'answer']);
  });

  it('keeps the submit disabled while the answer is blank', () => {
    render(<RunAskCard organizationId="org-1" ask={ask} />);
    expect(
      screen.getByRole('button', { name: /send answer & resume/i }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/your answer/i), {
      target: { value: '   ' },
    });
    expect(
      screen.getByRole('button', { name: /send answer & resume/i }),
    ).toBeDisabled();
  });
});
