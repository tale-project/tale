// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  AgentNeedsAnswerIndicator,
  AgentWorkingIndicator,
  BlockedIndicator,
  CommentCountIndicator,
  DueDateIndicator,
  NeedsReviewIndicator,
  RepeatIndicator,
  SubtaskProgress,
} from './task-indicators';

// #4062: a board renders every indicator on every card, and most show
// nothing. Their translation and date hooks used to run anyway — on 2,000
// cards, seconds of the board's mount.

const { translationHook, dateHook } = vi.hoisted(() => ({
  translationHook: vi.fn(),
  dateHook: vi.fn(),
}));

vi.mock('@/lib/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n/client')>();
  return {
    ...actual,
    useT: (namespace: Parameters<typeof actual.useT>[0]) => {
      translationHook(namespace);
      return actual.useT(namespace);
    },
  };
});
vi.mock('@tale/ui/use-format-date', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tale/ui/use-format-date')>();
  return {
    ...actual,
    useFormatDate: () => {
      dateHook();
      return actual.useFormatDate();
    },
  };
});

describe('task indicators with nothing to show', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('run no translation or date hook', () => {
    render(
      <>
        <BlockedIndicator blocked={false} />
        <CommentCountIndicator count={0} />
        <SubtaskProgress done={0} total={0} />
        <AgentWorkingIndicator working={false} />
        <AgentNeedsAnswerIndicator asking={false} />
        <NeedsReviewIndicator needsReview={false} reviewerName="Alex" />
        <RepeatIndicator
          repeat={{ frequency: 'daily', interval: 1, timezone: 'UTC' }}
          status="done"
          continued={false}
        />
        <DueDateIndicator dueDate={undefined} status="todo" />
      </>,
    );

    expect(translationHook).not.toHaveBeenCalledWith('tasks');
    expect(dateHook).not.toHaveBeenCalled();
  });

  it('show their chip once the fact turns up, and drop it again', () => {
    const due = Date.UTC(2030, 0, 15);
    const view = render(
      <>
        <BlockedIndicator blocked={false} />
        <DueDateIndicator dueDate={undefined} status="todo" />
      </>,
    );
    expect(screen.queryByLabelText('Blocked')).not.toBeInTheDocument();

    view.rerender(
      <>
        <BlockedIndicator blocked />
        <DueDateIndicator dueDate={due} status="todo" />
      </>,
    );
    expect(screen.getByLabelText('Blocked')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Due /)).toBeInTheDocument();
    expect(dateHook).toHaveBeenCalled();

    view.rerender(
      <>
        <BlockedIndicator blocked={false} />
        <DueDateIndicator dueDate={undefined} status="todo" />
      </>,
    );
    expect(screen.queryByLabelText('Blocked')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Due /)).not.toBeInTheDocument();
  });
});
