import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen } from '@/tests/utils/render';

import { RunAskCard, type RunPendingAsk } from './run-ask-card';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../hooks/mutations', () => ({
  useAnswerHumanAsk: () => ({ mutateAsync }),
}));

const askA: RunPendingAsk = {
  askId: 'ask-A',
  question: 'Which invoice amount should govern?',
};
const askB: RunPendingAsk = {
  askId: 'ask-B',
  question: 'Which folder should be removed?',
};
const structuredA: RunPendingAsk = {
  ...askA,
  questions: {
    questions: [
      {
        id: 'amount',
        question: askA.question,
        options: [{ label: '1580 CHF' }, { label: '1850 CHF' }],
      },
      {
        id: 'folder',
        question: 'Which invoice folder?',
        options: [{ label: 'Invoices' }, { label: 'Archive' }],
      },
    ],
  },
};
const structuredB: RunPendingAsk = {
  ...askB,
  questions: {
    questions: [
      {
        id: 'folder',
        question: askB.question,
        options: [{ label: 'Drafts' }, { label: 'Duplicates' }],
      },
    ],
  },
};

function RunSurface({ runId, ask }: { runId: string; ask: RunPendingAsk }) {
  return (
    <section data-run-id={runId}>
      <RunAskCard organizationId="audit-org" ask={ask} />
    </section>
  );
}

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue(null);
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe.each(['en', 'de', 'fr'])('ask identity (%s)', (locale) => {
  beforeEach(async () => {
    await i18n.changeLanguage(locale);
  });

  it.each(['run-B', 'run-A'])(
    'clears the draft on a new ask in %s and only sends its own answer',
    async (runId) => {
      const { rerender } = render(<RunSurface runId="run-A" ask={askA} />);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Use 1580 CHF' },
      });
      rerender(<RunSurface runId={runId} ask={askB} />);
      expect(screen.getByTestId('run-ask-question')).toHaveTextContent(
        askB.question,
      );
      expect(screen.getByRole('textbox')).toHaveValue('');
      const submit = screen.getByRole('button');
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(mutateAsync).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Remove duplicates' },
      });
      fireEvent.click(submit);
      await waitFor(() =>
        expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
          organizationId: 'audit-org',
          askId: 'ask-B',
          answer: 'Remove duplicates',
        }),
      );
    },
  );

  it('keeps the unsent draft on a same-ask refetch', () => {
    const { rerender } = render(
      <RunAskCard organizationId="audit-org" ask={askA} />,
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Use 1580 CHF' },
    });
    rerender(<RunAskCard organizationId="audit-org" ask={{ ...askA }} />);
    expect(screen.getByRole('textbox')).toHaveValue('Use 1580 CHF');
    expect(screen.getByRole('button')).toBeEnabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('starts a shorter ask at question one with fresh drafts and focus', async () => {
    const { rerender, user } = render(
      <RunSurface runId="run-A" ask={structuredA} />,
    );
    await user.click(screen.getByRole('radio', { name: '1580 CHF' }));
    expect(screen.getByText('Which invoice folder?')).toBeInTheDocument();
    const otherLabel = i18n.t('otherOption', { ns: 'questions' });
    await user.click(screen.getByRole('radio', { name: otherLabel }));
    await user.type(screen.getByRole('textbox'), 'Keep invoices');
    rerender(<RunSurface runId="run-B" ask={structuredB} />);
    expect(screen.getByText(askB.question)).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Drafts' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Drafts' })).toHaveFocus();
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: otherLabel }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('preserves the cursor and structured draft on a same-ask refetch', async () => {
    const { rerender, user } = render(
      <RunAskCard organizationId="audit-org" ask={structuredA} />,
    );
    await user.click(screen.getByRole('radio', { name: '1580 CHF' }));
    await user.click(
      screen.getByRole('radio', {
        name: i18n.t('otherOption', { ns: 'questions' }),
      }),
    );
    await user.type(screen.getByRole('textbox'), 'Keep invoices');
    rerender(
      <RunAskCard
        organizationId="audit-org"
        ask={{
          ...structuredA,
          questions: structuredClone(structuredA.questions),
        }}
      />,
    );
    expect(screen.getByText('Which invoice folder?')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('Keep invoices');
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

it('does not carry refusal feedback into a new ask', async () => {
  mutateAsync.mockRejectedValueOnce(new Error('Ask A was refused'));
  const { rerender } = render(
    <RunAskCard organizationId="audit-org" ask={askA} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Use 1580 CHF' },
  });
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Ask A was refused');
  rerender(<RunAskCard organizationId="audit-org" ask={askB} />);
  expect(screen.queryByText('Ask A was refused')).not.toBeInTheDocument();
});

it('isolates a pending answer and its late refusal from the new ask', async () => {
  let rejectAnswer: (error: Error) => void = () => {
    throw new Error('No pending answer');
  };
  mutateAsync.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectAnswer = reject;
      }),
  );
  const { rerender } = render(
    <RunAskCard organizationId="audit-org" ask={askA} />,
  );
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Use 1580 CHF' },
  });
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('textbox')).toBeDisabled();
  rerender(<RunAskCard organizationId="audit-org" ask={askB} />);
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'Remove duplicates' },
  });
  await act(async () => {
    rejectAnswer(new Error('Late refusal for A'));
  });
  expect(screen.queryByText('Late refusal for A')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Remove duplicates');
  expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
    organizationId: 'audit-org',
    askId: 'ask-A',
    answer: 'Use 1580 CHF',
  });
});
