import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  askId: 'ask-1' as string,
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

// Choices are OPTIONAL on this lane, unlike chat's ask_question: a run's
// blocker is often genuinely open, so the card has to serve both shapes.
describe('RunAskCard with offered choices', () => {
  const withChoices = {
    askId: 'ask-2' as string,
    question: 'How should I handle the mismatch?',
    questions: {
      questions: [
        {
          id: 'handling',
          question: 'How should I handle the mismatch?',
          options: [
            { label: 'Use the higher amount' },
            { label: 'Use the lower amount' },
          ],
        },
      ],
    },
  };

  it('renders the shared question flow instead of an open box', () => {
    render(<RunAskCard organizationId="org-1" ask={withChoices} />);
    expect(
      screen.getByRole('radio', { name: /Use the higher amount/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // No composer on this lane to hand back to, and the card IS the surface —
  // so the two chat-only affordances must not appear.
  it('offers neither Type instead nor Answer later', () => {
    render(<RunAskCard organizationId="org-1" ask={withChoices} />);
    expect(
      screen.queryByRole('button', { name: 'Type instead' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Answer later' }),
    ).not.toBeInTheDocument();
  });

  it('records the picked option as the answer text', async () => {
    mutateAsync.mockClear();
    mutateAsync.mockResolvedValue(null);
    render(<RunAskCard organizationId="org-1" ask={withChoices} />);
    fireEvent.click(
      screen.getByRole('radio', { name: /Use the higher amount/ }),
    );
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        askId: 'ask-2',
        answer: 'How should I handle the mismatch? → Use the higher amount',
      });
    });
  });

  it('still shows one open box when no choices were offered', () => {
    render(<RunAskCard organizationId="org-1" ask={ask} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
