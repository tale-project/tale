import { CircleDot, History } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  ThreadEvent,
  ThreadEventActor,
  ThreadEventGroup,
} from './thread-event';

describe('ThreadEvent', () => {
  it('reads as one sentence with the actor marked and the time at the end', () => {
    render(
      <ThreadEvent icon={CircleDot} time="14:32">
        <ThreadEventActor>Anna</ThreadEventActor> moved the task to Done
      </ThreadEvent>,
    );
    const line = screen.getByText(/moved the task to Done/);
    expect(line).toHaveTextContent('Anna moved the task to Done·14:32');
    expect(screen.getByText('Anna')).toHaveClass(
      'text-foreground',
      'font-medium',
    );
    expect(line).toHaveClass('text-xs', 'text-muted-foreground');
  });

  it('keeps the gutter as wide as a message avatar', () => {
    const { container } = render(
      <ThreadEvent icon={CircleDot}>Something happened</ThreadEvent>,
    );
    const glyph = container.querySelector('[data-slot="thread-event-glyph"]');
    expect(glyph?.parentElement).toHaveClass('size-6');
    expect(glyph?.querySelector('svg')).toHaveClass('size-3.5');
  });

  it('takes a custom gutter mark and a trailing node', () => {
    render(
      <ThreadEvent glyph={<span data-testid="status" />} trailing="Failed">
        Run failed
      </ThreadEvent>,
    );
    expect(screen.getByTestId('status')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('opens its detail from the sentence', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <ThreadEvent
          icon={CircleDot}
          expanded={open}
          onToggle={() => setOpen((value) => !value)}
          detail={<p>The full description</p>}
        >
          Anna changed the description
        </ThreadEvent>
      );
    }
    const { user } = render(<Harness />);
    const toggle = screen.getByRole('button', {
      name: /Anna changed the description/,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('The full description')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByText('The full description').parentElement;
    expect(toggle).toHaveAttribute('aria-controls', detail?.id);
  });

  it('forwards its element and attributes', () => {
    render(
      <ul>
        <ThreadEvent as="li" data-task-history-entry="" icon={CircleDot}>
          Event
        </ThreadEvent>
      </ul>,
    );
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'data-task-history-entry',
    );
  });
});

describe('ThreadEventGroup', () => {
  function renderGroup(onExpandedChange = vi.fn()) {
    return render(
      <ThreadEventGroup
        icon={History}
        summary="3 updates · Anna, Kim"
        time="14:02 – 14:20"
        onExpandedChange={onExpandedChange}
      >
        <ThreadEvent as="li" icon={CircleDot}>
          Anna moved the task to In progress
        </ThreadEvent>
        <ThreadEvent as="li" icon={CircleDot}>
          Kim set the priority to High
        </ThreadEvent>
        <ThreadEvent as="li" icon={CircleDot}>
          Anna set the due date
        </ThreadEvent>
      </ThreadEventGroup>,
    );
  }

  it('folds its events behind one summary line', () => {
    renderGroup();
    const summary = screen.getByRole('button', {
      name: /3 updates · Anna, Kim/,
    });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByText('Kim set the priority to High'),
    ).not.toBeInTheDocument();
  });

  it('opens in place into a list tied by a gutter rule', async () => {
    const onExpandedChange = vi.fn();
    const { user } = renderGroup(onExpandedChange);
    const summary = screen.getByRole('button', { name: /3 updates/ });

    await user.click(summary);
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list');
    expect(summary).toHaveAttribute('aria-controls', list.id);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(list).toHaveClass('before:bg-border');

    await user.click(summary);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('passes an axe audit, folded and open', async () => {
    const { user, container } = renderGroup();
    await checkAccessibility(container);
    await user.click(screen.getByRole('button', { name: /3 updates/ }));
    await checkAccessibility(container);
  });
});
