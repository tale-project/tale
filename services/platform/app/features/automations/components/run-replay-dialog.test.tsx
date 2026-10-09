// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReplayPlan } from '@/app/lib/backend/contract/automations';
import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import {
  RunReplayDialog,
  type RunReplayDialogProps,
} from './run-replay-dialog';

// The dialog runs its real lane: `useReplayPlan`, `useReplayRun`, the
// adapters, `backendFetch` and react-query. Only the session probe and the
// network are synthetic: `fetch` answers the run's replay doors the way the
// backend does.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

const ORG = 'org-1';
const RUN = 'run-1';

/** A retry from `score` as `GET …/runs/:runId/replay` plans it. */
function planOf(overrides: Partial<ReplayPlan> = {}): ReplayPlan {
  return {
    kind: 'from',
    sourceRunId: RUN,
    version: { source: 3, target: 3, resolved: 'same' },
    mode: 'live',
    deployed: true,
    liveAllowed: true,
    reuse: [{ nodeId: 'fetch_orders', status: 'ok' }],
    rerun: [
      { nodeId: 'score', type: 'transform', effect: 'none' },
      {
        nodeId: 'send_invoice',
        type: 'imap-smtp.send',
        effect: 'write',
        connector: 'imap-smtp',
      },
    ],
    writesAgain: 2,
    spendAgain: { llm: 0, agent: 0 },
    ...overrides,
  };
}

type Answer = Response | Promise<Response>;
interface Doors {
  plan: () => Answer;
  replay: () => Answer;
  calls: { method: string; path: string; search: string; body: unknown }[];
}
let doors: Doors;

beforeEach(() => {
  doors = {
    plan: () => Response.json({ plan: planOf() }),
    replay: () =>
      Response.json(
        { runId: 'run-2', version: 3, mode: 'live', kind: 'from', reused: 1 },
        { status: 201 },
      ),
    calls: [],
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.href;
    const url = new URL(href, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body: unknown =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    doors.calls.push({ method, path: url.pathname, search: url.search, body });
    if (url.pathname === `/api/app/automations/runs/${RUN}/replay`) {
      return method === 'POST' ? doors.replay() : doors.plan();
    }
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(props: Partial<RunReplayDialogProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 1 } },
  });
  const onStarted = vi.fn();
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <RunReplayDialog
        open
        onOpenChange={onOpenChange}
        organizationId={ORG}
        run={{ id: RUN, version: 3, mode: 'live' }}
        from="score"
        stepLabel={(id) => id.replaceAll('_', ' ')}
        failedHere
        canStartLive
        onStarted={onStarted}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, onStarted, onOpenChange };
}

function deferred(): {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
} {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('RunReplayDialog — the plan', () => {
  it('masks the lists while the plan loads, offering nothing to start', async () => {
    const answer = deferred();
    doors.plan = () => answer.promise;
    renderDialog();

    expect(
      screen.getByRole('status', { name: 'Working out what this would do' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Retry from score' }),
    ).toBeDisabled();

    answer.resolve(Response.json({ plan: planOf() }));
    expect(
      await screen.findByRole('heading', { name: 'Reused (1)' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry from score' }),
    ).toBeEnabled();
  });

  it('says what it reuses, what runs again, and which writes go out again', async () => {
    renderDialog();

    expect(
      await screen.findByRole('heading', { name: 'Runs again (2)' }),
    ).toBeVisible();
    expect(screen.getByText('fetch orders')).toBeVisible();
    expect(screen.getByText('send invoice')).toBeVisible();
    expect(
      screen.getByText('Running live sends 2 writes again, from send invoice.'),
    ).toBeVisible();
    const asked = new URLSearchParams(doors.calls[0]?.search);
    expect(Object.fromEntries(asked)).toMatchObject({
      kind: 'from',
      from: 'score',
      version: 'same',
      mode: 'live',
    });
  });

  it('passes an axe audit', async () => {
    const { baseElement } = renderDialog();
    await screen.findByRole('heading', { name: 'Reused (1)' });
    await checkAccessibility(baseElement);
  });

  it('explains a refusal, and offers nothing to start', async () => {
    doors.plan = () =>
      Response.json({
        plan: planOf({
          refusal: {
            code: 'REPLAY_GRAPH_CHANGED',
            message:
              'the version to run changed what the reused steps would compute',
            nodes: ['fetch_orders'],
          },
        }),
      });
    renderDialog();

    expect(
      await screen.findByText('The version changed steps it would reuse'),
    ).toBeVisible();
    expect(
      screen.getByText(
        "The version to run changed fetch orders, so their results from this run don't fit. Run again from an earlier step, or on this run's version.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Retry from score' }),
    ).toBeDisabled();
  });

  it('offers to try again when the plan cannot be read', async () => {
    let broken = true;
    doors.plan = () =>
      broken
        ? Response.json({ error: 'INTERNAL' }, { status: 500 })
        : Response.json({ plan: planOf() });
    const { user } = renderDialog();

    const tryAgain = await screen.findByRole('button', { name: 'Try again' });
    expect(
      screen.getByText("Couldn't work out what this would do."),
    ).toBeVisible();
    broken = false;
    await user.click(tryAgain);
    expect(
      await screen.findByRole('heading', { name: 'Reused (1)' }),
    ).toBeVisible();
  });
});

describe('RunReplayDialog — mode', () => {
  it('keeps a test run’s retry a test', async () => {
    renderDialog({ run: { id: RUN, version: 3, mode: 'mock' } });

    const live = await screen.findByRole('radio', { name: /Live run/ });
    expect(live).toBeDisabled();
    expect(
      screen.getByText(
        "A test run's results were made up, so running it again from a step stays a test.",
      ),
    ).toBeVisible();
  });

  it('runs live only for a role that may', async () => {
    renderDialog({ canStartLive: false });

    expect(
      await screen.findByRole('radio', { name: /Live run/ }),
    ).toBeDisabled();
    expect(screen.getByText("Your role can't start live runs.")).toBeVisible();
  });
});

describe('RunReplayDialog — starting', () => {
  it('starts the retry it planned, and hands the new run on', async () => {
    const { user, onStarted, onOpenChange } = renderDialog();

    await user.click(
      await screen.findByRole('button', { name: 'Retry from score' }),
    );
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const post = doors.calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      kind: 'from',
      from: 'score',
      version: 'same',
      mode: 'live',
    });
    expect(post?.body).toHaveProperty('requestId');
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-2' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('says why a start was refused, keeping the dialog open', async () => {
    doors.replay = () =>
      Response.json(
        {
          error: 'ROLE_FORBIDDEN',
          message: 'Only authors may start live runs.',
        },
        { status: 403 },
      );
    const { user, onStarted } = renderDialog();

    await user.click(
      await screen.findByRole('button', { name: 'Retry from score' }),
    );
    expect(await screen.findByText(/^Couldn't start the run\./)).toBeVisible();
    expect(onStarted).not.toHaveBeenCalled();
  });
});
