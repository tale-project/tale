import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { QueuedMessageTray } from './queued-message-tray';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

interface QueueRow {
  queueId: string;
  messageId: string;
  savedMessageId?: string;
  text: string;
  status: 'queued' | 'claimed' | 'delivered' | 'consumed';
  createdAt: number;
}
let mockRows: QueueRow[] = [];
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: mockRows }),
}));

let mockAgentIdleAt: number | null = null;
vi.mock('../hooks/queries', () => ({
  useSessionProgress: () => ({ agentIdleAt: mockAgentIdleAt }),
}));

const mockDelete = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useDeleteQueuedMessage: () => ({ mutate: mockDelete }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

let mockReducedMotion = false;
vi.mock('@/app/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

function row(over: Partial<QueueRow> & { queueId: string }): QueueRow {
  return {
    messageId: over.queueId,
    text: 'hello',
    status: 'queued',
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRows = [];
  mockAgentIdleAt = null;
  mockReducedMotion = false;
});

describe('QueuedMessageTray', () => {
  it('renders waiting rows with their status and hides picked ones', () => {
    mockRows = [
      row({ queueId: 'q1', text: 'still waiting' }),
      row({ queueId: 'q2', text: 'staged', status: 'delivered' }),
      row({ queueId: 'q3', text: 'already picked', status: 'consumed' }),
    ];
    render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    expect(screen.getByText('still waiting')).toBeInTheDocument();
    expect(screen.getByText('queue.status.queued')).toBeInTheDocument();
    expect(screen.getByText('staged')).toBeInTheDocument();
    expect(screen.getByText('queue.status.delivered')).toBeInTheDocument();
    expect(screen.queryByText('already picked')).not.toBeInTheDocument();
  });

  it('renders nothing when there is nothing waiting', () => {
    mockRows = [row({ queueId: 'q1', status: 'consumed' })];
    const { container } = render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows "delivers now" for queued rows while the agent lingers', () => {
    mockAgentIdleAt = 123;
    mockRows = [row({ queueId: 'q1' })];
    render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    expect(screen.getByText('queue.status.deliversNow')).toBeInTheDocument();
  });

  it('offers remove only for still-queued rows and calls the mutation', () => {
    mockRows = [
      row({ queueId: 'q1', text: 'removable' }),
      row({ queueId: 'q2', text: 'staged', status: 'delivered' }),
    ];
    render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    const buttons = screen.getAllByRole('button', {
      name: 'queue.tray.remove',
    });
    expect(buttons).toHaveLength(1);
    buttons[0]?.click();
    expect(mockDelete).toHaveBeenCalledWith(
      { queueId: 'q1' },
      expect.anything(),
    );
  });

  it('bridges the enqueue round-trip with optimistic pending entries', () => {
    render(
      <QueuedMessageTray
        threadId="t1"
        organizationId="org-1"
        pending={[{ key: 'pq-1', text: 'in flight' }]}
      />,
    );
    expect(screen.getByText('in flight')).toBeInTheDocument();
    expect(screen.getByText('queue.status.queued')).toBeInTheDocument();
    // No queueId yet → no remove affordance.
    expect(
      screen.queryByRole('button', { name: 'queue.tray.remove' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a picked entry as a fading ghost, then drops it (min dwell)', () => {
    vi.useFakeTimers();
    try {
      mockRows = [row({ queueId: 'q1', text: 'fast pick' })];
      const { rerender } = render(
        <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
      );
      expect(screen.getByText('fast pick')).toBeInTheDocument();

      // The row is picked (consumed) — the entry must NOT vanish in the same
      // frame; it fades as a ghost with the "picked up" status.
      mockRows = [
        row({ queueId: 'q1', text: 'fast pick', status: 'consumed' }),
      ];
      rerender(
        <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
      );
      expect(screen.getByText('fast pick')).toBeInTheDocument();
      expect(screen.getByText('queue.status.consumed')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText('fast pick')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops picked entries immediately under prefers-reduced-motion', () => {
    mockReducedMotion = true;
    mockRows = [row({ queueId: 'q1', text: 'fast pick' })];
    const { rerender } = render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    mockRows = [row({ queueId: 'q1', text: 'fast pick', status: 'consumed' })];
    rerender(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    expect(screen.queryByText('fast pick')).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    mockRows = [
      row({ queueId: 'q1', text: 'still waiting' }),
      row({ queueId: 'q2', text: 'staged', status: 'delivered' }),
    ];
    const { container } = render(
      <QueuedMessageTray threadId="t1" organizationId="org-1" pending={[]} />,
    );
    await checkAccessibility(container);
  });
});
