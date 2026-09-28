// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';

import type { TaskRepeat } from '@/lib/shared/task-repeat';
import { render, screen } from '@/tests/utils/render';

import { RepeatIndicator } from './task-indicators';

const weekly: TaskRepeat = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [1],
  timezone: 'Europe/Zurich',
};

describe('RepeatIndicator', () => {
  it('names the rule an open task repeats on', () => {
    render(<RepeatIndicator repeat={weekly} status="todo" />);
    expect(
      screen.getByLabelText('Repeats: Weekly on Monday'),
    ).toBeInTheDocument();
  });

  it('says when a due-date series creates its next task', () => {
    render(
      <RepeatIndicator
        repeat={{ ...weekly, createOn: 'dueDate' }}
        status="todo"
      />,
    );
    const indicator = screen.getByLabelText(
      'Repeats: Weekly on Monday, next task on the due date',
    );
    // The Repeat row's glyph for that mode, so the card reads the same.
    expect(indicator.querySelector('svg.lucide-calendar-sync')).not.toBeNull();
  });

  it('renders nothing without a rule', () => {
    const { container } = render(<RepeatIndicator status="todo" />);
    expect(container).toBeEmptyDOMElement();
  });

  // A due-date series continues while the task is still open; the task
  // keeps its rule but never continues again — not even once that next task
  // is deleted — so no glyph promises another.
  it.each(['todo', 'in_progress', 'done'])(
    'renders nothing on a %s task that has handed its series on',
    (status) => {
      const { container } = render(
        <RepeatIndicator
          repeat={{ ...weekly, createOn: 'dueDate' }}
          status={status}
          continued
        />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );

  // A closed task that has not continued its series (the close failed to
  // make its next task) keeps its rule but will not come back until it is
  // reopened — no glyph promises it.
  it.each(['done', 'cancelled'])(
    'renders nothing on a %s task that still carries a rule',
    (status) => {
      const { container } = render(
        <RepeatIndicator repeat={weekly} status={status} />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );
});
