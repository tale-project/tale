import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegacyRunQuarantine } from '@/app/lib/backend/contract/automations';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { RunQuarantineCard } from './run-quarantine-card';

vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

const hold: LegacyRunQuarantine = {
  reason: 'legacy_execution_unproven',
  observedAt: 1791400000000,
  claimEpoch: 4,
  priorStatus: 'running',
  resolution: null,
};
let calls: { url: string; body: unknown }[];
let answer: () => Response;

beforeEach(() => {
  calls = [];
  answer = () =>
    Response.json({
      requested: true,
      status: 'quarantined',
      legacyQuarantine: {
        ...hold,
        resolution: {
          action: 'stop',
          actor: 'user:reviewer',
          at: hold.observedAt + 1,
        },
      },
    });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    calls.push({
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return answer();
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(
  quarantine: LegacyRunQuarantine | undefined = hold,
  canRequestStop = true,
) {
  const client = new QueryClient();
  const onReload = vi.fn();
  const card = (value: LegacyRunQuarantine | undefined) => (
    <QueryClientProvider client={client}>
      <RunQuarantineCard
        organizationId="org-1"
        runId="run-1"
        quarantine={value}
        onReload={onReload}
        canRequestStop={canRequestStop}
      />
    </QueryClientProvider>
  );
  const view = render(card(quarantine));
  return {
    ...view,
    onReload,
    change: (value: LegacyRunQuarantine | undefined) =>
      view.rerender(card(value)),
  };
}

describe('legacy quarantine stop request', () => {
  it('keeps the explanation readable without granting a read-only viewer a stop action', () => {
    setup(hold, false);
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request stop' })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('pins the confirmed hold and preserves the unknown outcome after acceptance', async () => {
    const { user, onReload } = setup();
    await user.click(screen.getByRole('button', { name: 'Request stop' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/does not confirm/)).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Request stop' }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('/runs/run-1/legacy-quarantine');
    expect(calls[0]?.body).toEqual({
      expectedClaimEpoch: 4,
      expectedObservedAt: hold.observedAt,
      action: 'stop',
      acknowledgeUnknownExternalEffects: true,
    });
    expect(
      screen.getByText(/Stop requested. The run stays on hold/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request stop' })).toBeNull();
  });

  it.each(['epoch', 'observation', 'resolution', 'missing'] as const)(
    'refuses a dialog after the hold changes: %s',
    async (change) => {
      const view = setup();
      await view.user.click(
        screen.getByRole('button', { name: 'Request stop' }),
      );
      view.change(
        change === 'missing'
          ? undefined
          : change === 'epoch'
            ? { ...hold, claimEpoch: 5 }
            : change === 'observation'
              ? { ...hold, observedAt: hold.observedAt + 1 }
              : {
                  ...hold,
                  resolution: {
                    action: 'stop',
                    actor: 'user:other',
                    at: hold.observedAt + 1,
                  },
                },
      );
      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByRole('button', { name: 'Request stop' }),
      ).toBeDisabled();
      expect(within(dialog).getByText(/The hold changed/)).toBeInTheDocument();
      await view.user.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      );
      expect(calls).toHaveLength(0);
    },
  );

  it('reports refusal once and reloads without claiming a successful stop', async () => {
    answer = () =>
      Response.json(
        { error: 'CONFLICT', message: 'The hold changed.' },
        { status: 409 },
      );
    const { user, onReload } = setup();
    await user.click(screen.getByRole('button', { name: 'Request stop' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Request stop',
      }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledOnce());
    expect(
      screen.getAllByText(/The stop request could not be saved/),
    ).toHaveLength(1);
    expect(
      screen.queryByText(/Stop requested. The run stays on hold/),
    ).toBeNull();
  });
});
