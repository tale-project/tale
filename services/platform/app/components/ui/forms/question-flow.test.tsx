import { describe, expect, it, vi } from 'vitest';

import type { QuestionSet } from '@/lib/shared/schemas/questions';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { QuestionFlow } from './question-flow';

const THREE: QuestionSet = {
  questions: [
    {
      id: 'purpose',
      question: "What's the purpose of this email?",
      options: [
        { label: 'Request an approval' },
        { label: 'Follow up on a meeting' },
      ],
    },
    {
      id: 'recipient',
      question: 'Who is the recipient?',
      options: [{ label: 'My manager' }, { label: 'A client' }],
    },
    {
      id: 'tone',
      question: 'What tone should it take?',
      options: [{ label: 'Formal' }, { label: 'Warm' }],
    },
  ],
};

const ONE: QuestionSet = {
  questions: [
    {
      id: 'tone',
      question: 'What tone should it take?',
      options: [{ label: 'Formal' }, { label: 'Warm' }],
    },
  ],
};

const MULTI: QuestionSet = {
  questions: [
    {
      id: 'channels',
      question: 'Which channels should it go to?',
      multiSelect: true,
      options: [{ label: 'Email' }, { label: 'Slack' }],
    },
  ],
};

describe('QuestionFlow', () => {
  it('shows only the current question, never the whole set', () => {
    render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    expect(
      screen.getByText("What's the purpose of this email?"),
    ).toBeInTheDocument();
    expect(screen.queryByText('Who is the recipient?')).not.toBeInTheDocument();
    expect(
      screen.queryByText('What tone should it take?'),
    ).not.toBeInTheDocument();
  });

  it('always offers the client-injected free-text escape', () => {
    render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /Other/ })).toBeInTheDocument();
  });

  it('advances when a single-select option is picked', async () => {
    const { user } = render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );
    expect(screen.getByText('Who is the recipient?')).toBeInTheDocument();
  });

  it('goes back to the previous question', async () => {
    const { user } = render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByText("What's the purpose of this email?"),
    ).toBeInTheDocument();
  });

  // Back used to be a one-way trip. On an answered single-select the only
  // forward control was the options themselves, and re-clicking the one
  // already chosen leaves the radio's value unchanged — so it fires nothing,
  // and the reader was stranded on a question they had already answered.
  it('offers a way forward again after going back', async () => {
    const { user } = render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Who is the recipient?')).toBeInTheDocument();
  });

  it('keeps the earlier answer selected when going back', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<QuestionFlow set={THREE} onSubmit={onSubmit} />);
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('radio', { name: /Request an approval/ }),
    ).toBeChecked();
    // And it still rides through to the submitted set.
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: /A client/ }));
    await user.click(screen.getByRole('radio', { name: /Warm/ }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'purpose', selected: ['Request an approval'] },
      { questionId: 'recipient', selected: ['A client'] },
      { questionId: 'tone', selected: ['Warm'] },
    ]);
  });

  // The escape hatch opens a field; it must not skip past the question the
  // reader just said none of the options fit.
  it('reveals a text field for Other instead of advancing', async () => {
    const { user } = render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: /Other/ }));
    expect(
      screen.getByText("What's the purpose of this email?"),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('submits every answer in one call', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<QuestionFlow set={THREE} onSubmit={onSubmit} />);
    await user.click(
      screen.getByRole('radio', { name: /Request an approval/ }),
    );
    await user.click(screen.getByRole('radio', { name: /A client/ }));
    await user.click(screen.getByRole('radio', { name: /Warm/ }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'purpose', selected: ['Request an approval'] },
      { questionId: 'recipient', selected: ['A client'] },
      { questionId: 'tone', selected: ['Warm'] },
    ]);
  });

  it('carries typed free text through to the answer', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<QuestionFlow set={ONE} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('radio', { name: /Other/ }));
    await user.type(screen.getByRole('textbox'), 'Something else');
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'tone', selected: [], freeText: 'Something else' },
    ]);
  });

  // Stepping one question is pure overhead — the research puts the payoff at
  // five-to-ten fields, so a lone question gets no counter and no Back.
  it('drops the progress chrome for a single question', () => {
    render(<QuestionFlow set={ONE} onSubmit={vi.fn()} />);
    expect(screen.queryByText(/Question 1 of/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Back' }),
    ).not.toBeInTheDocument();
  });

  it('shows the step counter once there is more than one question', () => {
    render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
  });

  it('waits for Next on a multi-select rather than advancing on each pick', async () => {
    const onSubmit = vi.fn();
    const { user } = render(<QuestionFlow set={MULTI} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('checkbox', { name: /Email/ }));
    await user.click(screen.getByRole('checkbox', { name: /Slack/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Send answer' }));
    expect(onSubmit).toHaveBeenCalledWith([
      { questionId: 'channels', selected: ['Email', 'Slack'] },
    ]);
  });

  // Nothing here may trap: Esc hands the input back, and so does the button.
  it('collapses on Escape without deciding anything', async () => {
    const onCollapse = vi.fn();
    const onSkip = vi.fn();
    const { user } = render(
      <QuestionFlow
        set={THREE}
        onSubmit={vi.fn()}
        onSkip={onSkip}
        onCollapse={onCollapse}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onCollapse).toHaveBeenCalledTimes(1);
    // A habitual keypress must never discard the question.
    expect(onSkip).not.toHaveBeenCalled();
  });

  // "Answer later" promised a later that almost never existed: the only
  // reason to leave the panel is to reach the composer, and typing retires
  // the question. The button now says what the system actually records.
  it('gives up on the question outright via Skip', async () => {
    const onSkip = vi.fn();
    const { user } = render(
      <QuestionFlow set={THREE} onSubmit={vi.fn()} onSkip={onSkip} />,
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  // Removing "Type instead" is only safe BECAUSE `Other…` is unconditional:
  // the client appends it to every question, so there is always a way to
  // answer in your own words without leaving the flow. If that ever became
  // conditional, the escape would silently disappear on some questions — so
  // it is pinned on every question of a set, not just the first.
  it('offers Other on every question, not only the first', async () => {
    const { user } = render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    for (const answer of ['Request an approval', 'A client']) {
      expect(screen.getByRole('radio', { name: /Other/ })).toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: answer }));
    }
    expect(screen.getByText('What tone should it take?')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Other/ })).toBeInTheDocument();
  });

  it('has no button for abandoning the set — sending a message says that', () => {
    render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    expect(
      screen.queryByRole('button', { name: 'Type instead' }),
    ).not.toBeInTheDocument();
  });

  it('warns that picking advances, before it does (WCAG 3.2.2)', () => {
    render(<QuestionFlow set={THREE} onSubmit={vi.fn()} />);
    expect(
      screen.getByText('Picking an answer moves to the next question.'),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <QuestionFlow set={THREE} onSubmit={vi.fn()} onSkip={vi.fn()} />,
    );
    await checkAccessibility(container);
  });
});
