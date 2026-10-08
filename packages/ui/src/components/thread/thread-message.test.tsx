import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ThreadMessage } from './thread-message';

afterEach(() => {
  vi.restoreAllMocks();
});

function Edit() {
  return (
    <button type="button" aria-label="Edit comment">
      ✎
    </button>
  );
}

describe('ThreadMessage', () => {
  it('draws another voice as an identity row over indented prose', () => {
    const { container } = render(
      <ThreadMessage
        avatar={<span data-testid="avatar" />}
        author="Yara Polish"
        badge={<span>Agent</span>}
        time={<time dateTime="2026-10-08T14:32:00Z">14:32</time>}
        meta="(edited)"
      >
        Looks great.
      </ThreadMessage>,
    );

    const header = container.querySelector(
      '[data-slot="thread-message-header"]',
    );
    expect(header).toHaveTextContent('Yara PolishAgent14:32(edited)');
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="thread-message-body"]'),
    ).toHaveClass('pl-8', 'text-sm', 'leading-6');
    expect(container.firstElementChild).toHaveAttribute(
      'data-variant',
      'other',
    );
  });

  it('draws the viewer’s own words as a bubble with facts under it', () => {
    const { container } = render(
      <ThreadMessage variant="own" time="14:32" actions={<Edit />}>
        My comment
      </ThreadMessage>,
    );

    expect(
      container.querySelector('[data-slot="thread-message-header"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="thread-message-body"]'),
    ).toHaveClass('bg-muted', 'rounded-2xl', 'max-w-[85%]');
    const footer = container.querySelector(
      '[data-slot="thread-message-footer"]',
    );
    expect(footer).toHaveTextContent('14:32');
    expect(footer).toContainElement(
      screen.getByRole('button', { name: 'Edit comment' }),
    );
  });

  it('drops the identity row of a continuation and closes the gap', () => {
    const { container } = render(
      <ThreadMessage author="Yara Polish" time="14:33" continuation>
        And one more thing.
      </ThreadMessage>,
    );

    const root = container.firstElementChild;
    expect(root).toHaveAttribute('data-continuation');
    expect(root).toHaveClass('-mt-4');
    expect(screen.queryByText('Yara Polish')).not.toBeInTheDocument();
    // The body stays aligned with the previous message's body.
    expect(
      container.querySelector('[data-slot="thread-message-body"]'),
    ).toHaveClass('pl-8');
    // Its time is still there for whoever looks for it.
    expect(screen.getByText('14:33')).toBeInTheDocument();
  });

  it('hides the identity row and the indent with header={null}', () => {
    const { container } = render(
      <ThreadMessage header={null} author="Assistant">
        The answer.
      </ThreadMessage>,
    );
    expect(screen.queryByText('Assistant')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="thread-message-body"]'),
    ).not.toHaveClass('pl-8');
  });

  it('takes a custom identity row', () => {
    render(
      <ThreadMessage header={<span>Custom identity</span>}>Body</ThreadMessage>,
    );
    expect(screen.getByText('Custom identity')).toBeInTheDocument();
  });

  it('reveals actions on hover, focus, an open menu, and always on touch', () => {
    const { container } = render(
      <ThreadMessage author="Anna" actions={<Edit />}>
        Body
      </ThreadMessage>,
    );
    const actions = container.querySelector(
      '[data-slot="thread-message-actions"]',
    );
    expect(actions).toHaveClass(
      'opacity-0',
      'group-hover/thread-message:opacity-100',
      'group-focus-within/thread-message:opacity-100',
      'has-[[data-state=open]]:opacity-100',
      'pointer-coarse:opacity-100',
    );
  });

  it('forwards its element, ref, classes and data attributes to the root', () => {
    const ref = createRef<HTMLElement>();
    render(
      <ul>
        <ThreadMessage
          as="li"
          ref={ref}
          author="Anna"
          data-task-history-entry=""
          className="[content-visibility:auto]"
        >
          Body
        </ThreadMessage>
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(ref.current).toBe(item);
    expect(item).toHaveAttribute('data-task-history-entry');
    expect(item).toHaveClass('[content-visibility:auto]');
  });

  it('clamps a long body behind Read more when asked', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
      3000,
    );
    const { container } = render(
      <ThreadMessage author="My Opus Agent #3" clampHeight={320}>
        A very long report
      </ThreadMessage>,
    );
    expect(
      container.querySelector('[data-slot="read-more-content"]'),
    ).toHaveAttribute('data-clamped');
    expect(screen.getByRole('button', { name: 'Read more' })).toBeVisible();
  });

  it('clamps an own bubble with the fade in the bubble colour', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(
      3000,
    );
    const { container } = render(
      <ThreadMessage variant="own" clampHeight={384}>
        A very long message
      </ThreadMessage>,
    );
    const region = container.querySelector('[data-slot="read-more-content"]');
    expect(region).toHaveClass('bg-muted', 'rounded-2xl');
    expect(region?.querySelector('.bg-gradient-to-t')).toHaveClass(
      'from-muted',
    );
    expect(screen.getByRole('button', { name: 'Read more' })).toHaveClass(
      'self-end',
    );
  });

  it('passes an axe audit in both shapes', async () => {
    const { container } = render(
      <ul>
        <ThreadMessage as="li" author="Anna" time="14:30" actions={<Edit />}>
          Hello
        </ThreadMessage>
        <ThreadMessage as="li" variant="own" time="14:31" actions={<Edit />}>
          Hi Anna
        </ThreadMessage>
      </ul>,
    );
    await checkAccessibility(container);
  });
});
