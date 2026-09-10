import { describe, expect, it, vi } from 'vitest';

import type { SandboxCapacity } from '@/app/lib/backend/contract/sandbox';
import { render, screen } from '@/tests/utils/render';

import { SandboxCapacitySection } from './sandbox-capacity';
import { sandboxRuntimeState } from './sandbox-runtime-state';

const snapshot = {
  status: 'available',
  observedAt: Date.parse('2026-09-10T04:30:00Z'),
  backend: 'docker',
  scope: 'host',
  sessions: {
    running: 4,
    starting: 1,
    limit: 16,
    organizationRunning: 1,
    organizationStarting: 1,
    organizationLimit: 16,
  },
  resources: {
    cpu: { totalCores: 8, usedCores: 2.5 },
    memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 12 * 1024 ** 3 },
  },
  runtimeSessions: [{ sessionId: 'standing-agent', state: 'running' }],
} satisfies SandboxCapacity;

function capacityView(capacity: SandboxCapacity | undefined) {
  return (
    <SandboxCapacitySection
      capacity={capacity}
      isLoading={false}
      isRefreshing={false}
      onRefresh={vi.fn()}
    />
  );
}

describe('SandboxCapacitySection', () => {
  it('separates deployment capacity, actual organization sandboxes, and measured resources', () => {
    const { container } = render(capacityView(snapshot));
    expect(screen.getByText('5 / 16')).toBeInTheDocument();
    expect(screen.getByText('Deployment sandboxes')).toBeInTheDocument();
    expect(
      screen.getByText("Your organization's sandboxes"),
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/^2 \/ /)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Currently running or starting / deployment capacity, shared by all organizations.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Currently running or starting, including idle sandboxes kept for reuse.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('4 running · 1 starting')).toBeInTheDocument();
    expect(screen.getByText('2.5 / 8 cores')).toBeInTheDocument();
    expect(screen.getByText('12 / 32 GiB')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute(
      'dateTime',
      '2026-09-10T04:30:00.000Z',
    );
  });

  it.each([
    undefined,
    { status: 'unavailable', reason: 'unreachable' } satisfies SandboxCapacity,
  ])('never presents unavailable infrastructure as zero usage', (capacity) => {
    render(capacityView(capacity));
    expect(screen.getAllByText('Unavailable')).toHaveLength(4);
    expect(screen.queryByText(/0 \/ /)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Runtime state and resource usage are unknown.',
    );
  });

  it('keeps a missing CPU sample unknown while showing a known total', () => {
    render(
      capacityView({
        ...snapshot,
        resources: {
          ...snapshot.resources,
          cpu: { totalCores: 8, usedCores: null },
        },
      }),
    );
    expect(screen.getByText('Unavailable / 8 cores')).toBeInTheDocument();
    expect(screen.queryByText('0 / 8 cores')).not.toBeInTheDocument();
  });

  it('labels Kubernetes counts as namespace scope without fabricating hardware', () => {
    render(
      capacityView({
        ...snapshot,
        backend: 'kubernetes',
        scope: 'namespace',
        resources: {
          cpu: { totalCores: null, usedCores: null },
          memory: { totalBytes: null, usedBytes: null },
        },
      }),
    );
    expect(
      screen.getByText('Deployment sandboxes (namespace)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Kubernetes namespace scope/)).toBeInTheDocument();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
  });

  it('refreshes on request and disables repeated refresh while fetching', async () => {
    const refresh = vi.fn();
    const { user, rerender } = render(
      <SandboxCapacitySection
        capacity={snapshot}
        isLoading={false}
        isRefreshing={false}
        onRefresh={refresh}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();
    rerender(
      <SandboxCapacitySection
        capacity={snapshot}
        isLoading={false}
        isRefreshing
        onRefresh={refresh}
      />,
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});

describe('runtime state independent from quota release', () => {
  it('keeps a running container running even after its business allocation ends', () => {
    expect(sandboxRuntimeState(snapshot, 'standing-agent')).toBe('running');
  });

  it('treats absence as stopped only after a successful infrastructure inventory', () => {
    expect(sandboxRuntimeState(snapshot, 'old-agent')).toBe('stopped');
    expect(sandboxRuntimeState(undefined, 'old-agent')).toBe('unknown');
    expect(
      sandboxRuntimeState(
        { status: 'unavailable', reason: 'unreachable' },
        'old-agent',
      ),
    ).toBe('unknown');
  });
});
