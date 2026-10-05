import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { GuardrailsOverview } from './guardrails-overview';

const { toastSpy, refetchSpy } = vi.hoisted(() => ({
  toastSpy: vi.fn(),
  refetchSpy: vi.fn(),
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({ formatDate: () => 'just now' }),
}));

// Mutable, hoisted so the mock factories can read it. A single `isLoading`
// toggle drives BOTH the three policy reads (status cards) and the events read
// (table), since the overview's loading state covers all of them. A source or
// kind filter narrows the events on the server, so a filtered read answers
// `filteredEvents` instead; `eventsLoading` holds the events read alone, and
// `eventsFailed` fails it.
const { state } = vi.hoisted(() => ({
  state: {
    isLoading: false,
    policy: { key: 'pii_config', config: { enabled: false } } as
      | Record<string, unknown>
      | undefined,
    events: [] as unknown[],
    filteredEvents: [] as unknown[],
    eventsLoading: false,
    eventsFailed: false,
    eventsFetching: false,
    staleEvents: false,
  },
}));

vi.mock('../hooks/queries', () => ({
  // Same shape for every policyType — the cards just read `enabled`.
  useGovernancePolicy: () => ({
    data: state.isLoading ? undefined : state.policy,
    isLoading: state.isLoading,
  }),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (_name: string, args: Record<string, unknown>) => ({
    data:
      state.isLoading ||
      state.eventsLoading ||
      (state.eventsFailed && !state.staleEvents)
        ? undefined
        : 'filterName' in args || 'kind' in args
          ? state.filteredEvents
          : state.events,
    isLoading: state.isLoading || state.eventsLoading,
    isError: state.eventsFailed,
    isFetching: state.eventsFetching,
    refetch: refetchSpy,
  }),
}));

const EVENT = {
  _id: 'event-1',
  organizationId: 'org-1',
  sanitizationRunId: 'run-1',
  threadId: 'thread-abc-999',
  filterName: 'pii',
  direction: 'input',
  kind: 'detected',
  categoryIds: [],
  createdAt: Date.now(),
};

function setLoaded() {
  state.isLoading = false;
  state.policy = { key: 'pii_config', config: { enabled: false } };
  state.events = [];
}
function setEnabledOnServer() {
  state.isLoading = false;
  state.policy = { key: 'pii_config', config: { enabled: true } };
  state.events = [];
}
function setLoading() {
  state.isLoading = true;
  state.policy = undefined;
  state.events = [];
}

beforeEach(() => {
  state.filteredEvents = [];
  state.eventsLoading = false;
  state.eventsFailed = false;
  state.eventsFetching = false;
  state.staleEvents = false;
  refetchSpy.mockReset();
});

describe('GuardrailsOverview', () => {
  describe('loaded state', () => {
    it('renders the section heading (static text, always real)', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /guardrails overview/i }),
      ).toBeInTheDocument();
    });

    it('renders the real empty-state once events settle with zero rows', () => {
      setLoaded();
      const { container } = render(
        <GuardrailsOverview organizationId="org-1" />,
      );
      // No table rendered for the empty-state — the real "no events" copy is.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
      expect(
        screen.getByRole('heading', { name: /no events yet/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/detections from flag \/ mask \/ block/i),
      ).toBeInTheDocument();
    });

    it('is not marked busy once loaded', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    // The status cards read the on/off flag from `config.enabled` — the only
    // place the app door carries it. Reading a policy-level `enabled` showed
    // every card "Off" for policies the server had enabled.
    it('reports a policy the server has enabled as On', () => {
      setEnabledOnServer();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.getAllByText('On')).toHaveLength(3);
      expect(screen.queryByText('Off')).not.toBeInTheDocument();
    });

    it('shows lean status cards with jump links and no instructional body copy', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);

      expect(screen.getAllByText('Not configured').length).toBeGreaterThan(0);
      expect(screen.getByText('Off')).toBeInTheDocument();
      expect(screen.queryByText(/^Disabled/)).not.toBeInTheDocument();
      expect(screen.queryByText(/add a category/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /content safety/i }),
      ).toHaveAttribute('href', '#guardrails-content-safety');
      expect(
        screen.getByRole('link', { name: /pii detection/i }),
      ).toHaveAttribute('href', '#guardrails-pii');
      expect(
        screen.getByRole('link', { name: /moderation provider/i }),
      ).toHaveAttribute('href', '#guardrails-moderation');
    });
  });

  describe('recent events read failure', () => {
    it('shows an accessible error and retry while preserving policy cards', async () => {
      setEnabledOnServer();
      state.eventsFailed = true;
      const { user } = render(<GuardrailsOverview organizationId="org-1" />);

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Could not load recent events',
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Recent guardrail events are unavailable.',
      );
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
      expect(screen.getAllByText('On')).toHaveLength(3);
      expect(
        screen.getByRole('link', { name: /pii detection/i }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });

    it.each(['empty', 'recorded'] as const)(
      'retains the error during retry and recovers to %s events',
      async (recovery) => {
        setLoaded();
        state.eventsFailed = true;
        const { user, rerender } = render(
          <GuardrailsOverview organizationId="org-1" />,
        );
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        state.eventsFetching = true;
        rerender(<GuardrailsOverview organizationId="org-1" />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
        expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(refetchSpy).toHaveBeenCalledTimes(1);

        state.eventsFetching = false;
        rerender(<GuardrailsOverview organizationId="org-1" />);
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(refetchSpy).toHaveBeenCalledTimes(2);

        state.eventsFailed = false;
        state.events = recovery === 'recorded' ? [EVENT] : [];
        rerender(<GuardrailsOverview organizationId="org-1" />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Retry' }),
        ).not.toBeInTheDocument();
        if (recovery === 'empty') {
          expect(
            screen.getByRole('heading', { name: /no events yet/i }),
          ).toBeInTheDocument();
        } else {
          expect(
            screen.getByRole('row', { name: /view event/i }),
          ).toBeInTheDocument();
          expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
        }
      },
    );

    it('shows a failed refresh instead of stale rows', () => {
      setLoaded();
      state.events = [EVENT];
      state.eventsFailed = true;
      state.staleEvents = true;
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.queryByRole('row', { name: /view event/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
    });
  });

  describe('loading state (skeletonized)', () => {
    it('exposes a busy/status region', () => {
      setLoading();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(screen.getAllByRole('status')[0]).toHaveAttribute(
        'aria-busy',
        'true',
      );
    });

    it('renders placeholder rows so the table reads as loading, not empty', () => {
      setLoading();
      const { container } = render(
        <GuardrailsOverview organizationId="org-1" />,
      );
      // Three placeholder rows in the table shell, NOT the empty-state copy.
      expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
      expect(screen.queryByText(/no events yet/i)).not.toBeInTheDocument();
    });

    it('keeps the real section heading while loading (no gray bar)', () => {
      setLoading();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(
        screen.getByRole('heading', { name: /guardrails overview/i }),
      ).toBeInTheDocument();
    });
  });

  // Sibling to #2669: a clipboard-write failure in the event detail sheet
  // used to surface the raw thrown error's `.message` (a dev-facing
  // `NotAllowedError: …` string) as the toast title instead of the
  // localized fallback.
  describe('event detail copy failure toast', () => {
    it('surfaces the localized "copy failed" message, not the raw clipboard error', async () => {
      setLoaded();
      toastSpy.mockClear();
      state.events = [EVENT];

      const { user } = render(<GuardrailsOverview organizationId="org-1" />);

      await user.click(screen.getByRole('row', { name: /view event/i }));

      const copyButton = await screen.findByRole('button', {
        name: 'thread-abc-999',
      });

      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(
        new Error('NotAllowedError: Write permission denied.'),
      );

      await user.click(copyButton);

      await waitFor(() => {
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Copy failed',
            variant: 'destructive',
          }),
        );
      });
      const [call] = toastSpy.mock.calls.at(-1) ?? [];
      expect(call?.title).not.toContain('NotAllowedError');
    });
  });

  // The events filter sits above its table, so it is disabled from here: no
  // event recorded and nothing narrowing the list leaves nothing to filter.
  describe('recent events filter', () => {
    const filterButton = () => screen.getByRole('button', { name: 'Filter' });

    it('is offered over recorded events', () => {
      setLoaded();
      state.events = [EVENT];
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(filterButton()).toBeEnabled();
    });

    it('is disabled while no event is recorded and no filter is set', () => {
      setLoaded();
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(filterButton()).toBeDisabled();
    });

    it('stays usable while the events load', () => {
      setLoaded();
      state.eventsLoading = true;
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(filterButton()).toBeEnabled();
    });

    it('stays usable when the events failed to load, since they are unknown', () => {
      setLoaded();
      state.eventsFailed = true;
      render(<GuardrailsOverview organizationId="org-1" />);
      expect(filterButton()).toBeEnabled();
    });

    it('stays usable when a filter narrows the events to nothing', async () => {
      setLoaded();
      state.events = [EVENT];
      const { user } = render(<GuardrailsOverview organizationId="org-1" />);

      await user.click(filterButton());
      await user.click(
        await screen.findByRole('button', {
          name: (name) => name.startsWith('Kind'),
        }),
      );
      await user.click(await screen.findByRole('radio', { name: 'Blocked' }));
      await user.keyboard('{Escape}');

      expect(
        screen.getByRole('heading', { name: /no events yet/i }),
      ).toBeInTheDocument();
      expect(filterButton()).toBeEnabled();
    });
  });
});
