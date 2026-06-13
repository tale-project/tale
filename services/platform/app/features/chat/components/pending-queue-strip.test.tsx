import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import {
  PendingQueueStrip,
  type PendingQueueItem,
} from './pending-queue-strip';

function item(overrides: Partial<PendingQueueItem> = {}): PendingQueueItem {
  return {
    queueId: 'q1' as Id<'chatMessageQueue'>,
    status: 'queued',
    text: 'investigate the European reaction',
    ...overrides,
  };
}

describe('PendingQueueStrip', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(
      <PendingQueueStrip items={[]} onRemove={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders one row per item with the message text', () => {
    const { getByText } = render(
      <PendingQueueStrip
        items={[
          item({ queueId: 'q1' as Id<'chatMessageQueue'>, text: 'first' }),
          item({ queueId: 'q2' as Id<'chatMessageQueue'>, text: 'second' }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    expect(getByText('first')).toBeTruthy();
    expect(getByText('second')).toBeTruthy();
  });

  it('shows a remove button only for queued items', () => {
    const { getAllByRole } = render(
      <PendingQueueStrip
        items={[
          item({ queueId: 'q1' as Id<'chatMessageQueue'>, status: 'queued' }),
          item({
            queueId: 'q2' as Id<'chatMessageQueue'>,
            status: 'delivered',
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    // Only the queued row exposes a remove button; delivered shows a label.
    expect(getAllByRole('button')).toHaveLength(1);
  });

  it('calls onRemove with the queueId when the remove button is clicked', async () => {
    const onRemove = vi.fn();
    const { getByRole, user } = render(
      <PendingQueueStrip
        items={[item({ queueId: 'q9' as Id<'chatMessageQueue'> })]}
        onRemove={onRemove}
      />,
    );
    await user.click(getByRole('button'));
    expect(onRemove).toHaveBeenCalledWith('q9');
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <PendingQueueStrip
        items={[
          item({ queueId: 'q1' as Id<'chatMessageQueue'>, status: 'queued' }),
          item({
            queueId: 'q2' as Id<'chatMessageQueue'>,
            status: 'delivered',
          }),
        ]}
        onRemove={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });
});
