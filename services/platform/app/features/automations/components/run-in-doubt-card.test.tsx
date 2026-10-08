// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import { i18n } from '@/lib/i18n/i18n';
import {
  type ShippedLocale,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { RunInDoubtCard } from './run-in-doubt-card';

// The card runs its real lane end to end: `useRunInDoubt` and
// `useResolveRunInDoubt`, the adapter rows, `backendFetch` and react-query.
// Only the session probe and the network are synthetic: `fetch` answers the
// run's in-doubt doors the way the backend does, and `EventSource` is an
// inert emitter the real hint hook listens to.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

const ORG = 'org-1';
const RUN = 'run-1';

/** An open in-doubt write as `GET …/runs/:runId/in-doubt` answers it. */
function attemptRow(
  attemptId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    attemptId,
    nodeId: 'send_invoice',
    itemIndex: 0,
    pass: 0,
    attempt: 1,
    kind: 'connector',
    nodeType: 'imap-smtp.send',
    connector: 'Email',
    action: 'send',
    input: { to: 'billing@example.test', subject: 'Invoice 42' },
    startedAt: 1_790_000_000_000,
    ...overrides,
  };
}

type Answer = Response | Promise<Response>;
interface Door {
  read: () => Answer;
  decide: (attemptId: string, body: unknown) => Answer;
  calls: { method: string; path: string; body: unknown }[];
}
let door: Door;

function answerWith(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** A run whose write waits on `attemptId` until a decision lands on it. */
function waitingOn(attemptId: string, overrides?: Record<string, unknown>) {
  let decided = false;
  door.read = () =>
    answerWith(200, {
      inDoubt: decided ? null : attemptRow(attemptId, overrides),
    });
  door.decide = () => {
    decided = true;
    return answerWith(200, { ok: true });
  };
}

class FakeEventSource {
  readyState = 1;
  constructor(readonly url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.readyState = 2;
  }
}

beforeEach(() => {
  window.history.pushState(
    {},
    '',
    `/dashboard/${ORG}/automations/x/runs/${RUN}`,
  );
  door = {
    read: () => answerWith(200, { inDoubt: null }),
    decide: () => answerWith(200, { ok: true }),
    calls: [],
  };
  vi.stubGlobal('EventSource', FakeEventSource);
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
    door.calls.push({ method, path: url.pathname, body });
    const decide =
      /^\/api\/app\/automations\/runs\/[^/]+\/in-doubt\/([^/]+)$/.exec(
        url.pathname,
      );
    if (method === 'POST' && decide) return door.decide(decide[1] ?? '', body);
    if (
      method === 'GET' &&
      url.pathname === `/api/app/automations/runs/${RUN}/in-doubt`
    ) {
      return door.read();
    }
    return answerWith(404, { error: 'NOT_FOUND' });
  });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

function Hints() {
  useBackendHints(ORG);
  return null;
}

function renderCard(props: { iterates?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 1 } },
  });
  const onFocusLost = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <Hints />
      <RunInDoubtCard
        organizationId={ORG}
        runId={RUN}
        node="send_invoice"
        onFocusLost={onFocusLost}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, client, onFocusLost };
}

const decisions = () =>
  door.calls.filter((call) => call.method === 'POST').map((call) => call.body);

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

describe('RunInDoubtCard — the write', () => {
  it('names the step while it loads, offering nothing to press', async () => {
    const answer = deferred();
    door.read = () => answer.promise;
    renderCard();

    expect(
      screen.getByText('This step may already have run: send_invoice'),
    ).toBeVisible();
    expect(
      screen.getByRole('status', { name: 'Loading the step…' }),
    ).toBeInTheDocument();
    for (const name of ['Run it again', 'Skip it', 'Fail the run']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }

    answer.resolve(answerWith(200, { inDoubt: attemptRow('attempt-a') }));
    expect(
      await screen.findByRole('button', { name: 'Skip it' }),
    ).toBeEnabled();
  });

  it('says what was being sent where, and offers the three ways on', async () => {
    waitingOn('attempt-a');
    renderCard();

    expect(
      await screen.findByText(
        "The run was interrupted while this step was sending to Email. Tale can't tell whether Email received it. Check Email, then choose how to continue.",
      ),
    ).toBeVisible();
    expect(screen.getByText('The step was sending')).toBeVisible();
    expect(screen.getByText(/Invoice 42/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run it again' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fail the run' })).toBeEnabled();
    // What skipping means is part of the Skip button's description, not a
    // tooltip a keyboard reader never reaches.
    expect(
      screen.getByRole('button', { name: 'Skip it' }),
    ).toHaveAccessibleDescription(
      'The run continues as if the step returned nothing.',
    );
  });

  it('names the item of a step that runs once per item', async () => {
    waitingOn('attempt-a', { itemIndex: 2 });
    renderCard({ iterates: true });

    expect(
      await screen.findByText(
        /^The run was interrupted while this step was sending item 3 to Email\./,
      ),
    ).toBeVisible();
  });

  it('keeps the step named and offers Try again after a failed read', async () => {
    let up = false;
    door.read = () =>
      up
        ? answerWith(200, { inDoubt: attemptRow('attempt-a') })
        : answerWith(503, { error: 'unavailable' });
    const { user } = renderCard();

    expect(await screen.findByText("Couldn't load this step.")).toBeVisible();
    expect(
      screen.getByText('This step may already have run: send_invoice'),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip it' })).toBeNull();
    expect(screen.queryByText(/unavailable|503/)).toBeNull();

    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Skip it' }),
    ).toBeEnabled();
    expect(screen.queryByText("Couldn't load this step.")).toBeNull();
  });

  it('says the run continues when no write waits any more', async () => {
    renderCard();

    expect(
      await screen.findByText(
        'This step no longer waits for a decision — the run continues shortly.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip it' })).toBeNull();
  });

  it.each<[ShippedLocale, string, string]>([
    [
      'de',
      'Dieser Schritt ist vielleicht schon gelaufen: send_invoice',
      'Lauf fehlschlagen lassen',
    ],
    [
      'fr',
      // The matcher reads the catalog's no-break space before the colon as
      // a plain one.
      'Cette étape a peut-être déjà été exécutée : send_invoice',
      'Faire échouer l’exécution',
    ],
  ])('says it in %s', async (locale, title, fail) => {
    saveLocale(locale);
    await i18n.changeLanguage(locale);
    waitingOn('attempt-a');
    renderCard();

    expect(await screen.findByRole('button', { name: fail })).toBeEnabled();
    expect(screen.getByText(title)).toBeVisible();
  });
});

describe('RunInDoubtCard — the decision', () => {
  it('skips at once and moves focus to what happens next', async () => {
    waitingOn('attempt-a');
    const { user } = renderCard();

    await user.click(await screen.findByRole('button', { name: 'Skip it' }));

    const resolved = await screen.findByText('Skipped — the run continues.');
    expect(resolved).toBeVisible();
    expect(resolved.closest('[tabindex="-1"]')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Run it again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fail the run' })).toBeNull();
    expect(decisions()).toEqual([{ resolution: 'skip' }]);
  });

  it('asks before running the step again, and sends nothing on Cancel', async () => {
    waitingOn('attempt-a');
    const { user } = renderCard();

    await user.click(
      await screen.findByRole('button', { name: 'Run it again' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Run this step again?',
    });
    expect(dialog).toHaveTextContent(
      'If Email already received it, it happens twice.',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(decisions()).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Run it again' }));
    const again = await screen.findByRole('dialog', {
      name: 'Run this step again?',
    });
    await user.click(
      within(again).getByRole('button', { name: 'Run it again' }),
    );

    const resolved = await screen.findByText('Running the step again.');
    await waitFor(() =>
      expect(resolved.closest('[tabindex="-1"]')).toHaveFocus(),
    );
    expect(decisions()).toEqual([{ resolution: 'retry' }]);
  });

  it('works from the keyboard, and Escape hands focus back to the action', async () => {
    waitingOn('attempt-a');
    const { user } = renderCard();

    const retry = await screen.findByRole('button', { name: 'Run it again' });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Run this step again?' }),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(retry).toHaveFocus());
    expect(decisions()).toEqual([]);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Skip it' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const resolved = await screen.findByText('Skipped — the run continues.');
    await waitFor(() =>
      expect(resolved.closest('[tabindex="-1"]')).toHaveFocus(),
    );
    expect(decisions()).toEqual([{ resolution: 'skip' }]);
  });

  it('asks before failing the run', async () => {
    waitingOn('attempt-a');
    const { user } = renderCard();

    await user.click(
      await screen.findByRole('button', { name: 'Fail the run' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Fail this run?',
    });
    expect(dialog).toHaveTextContent(
      'The run stops here. Nothing it already did is undone.',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Fail the run' }),
    );

    expect(await screen.findByText('The run was failed.')).toBeVisible();
    expect(decisions()).toEqual([{ resolution: 'fail' }]);
  });

  it('reports a failed write once, without its payload, and the same press retries it', async () => {
    let attempts = 0;
    let decided = false;
    door.read = () =>
      answerWith(200, { inDoubt: decided ? null : attemptRow('attempt-a') });
    door.decide = () => {
      attempts += 1;
      if (attempts === 1) {
        return answerWith(500, { error: 'Internal Server Error' });
      }
      decided = true;
      return answerWith(200, { ok: true });
    };
    const { user } = renderCard();

    await user.click(await screen.findByRole('button', { name: 'Skip it' }));
    expect(
      await screen.findByText("Couldn't record your choice."),
    ).toBeVisible();
    expect(screen.getAllByText("Couldn't record your choice.")).toHaveLength(1);
    expect(screen.queryByText(/status 500|Internal Server Error/)).toBeNull();
    const skip = screen.getByRole('button', { name: 'Skip it' });
    await waitFor(() => expect(skip).toBeEnabled());

    await user.click(skip);
    expect(
      await screen.findByText('Skipped — the run continues.'),
    ).toBeVisible();
    expect(attempts).toBe(2);
  });

  it('shows the attempt on record after someone else decided first', async () => {
    let decidedElsewhere = false;
    door.read = () =>
      answerWith(200, {
        inDoubt: decidedElsewhere ? null : attemptRow('attempt-a'),
      });
    door.decide = () =>
      answerWith(409, {
        error: 'IN_DOUBT_ALREADY_RESOLVED',
        message:
          'This step was already decided, or it no longer waits for a decision.',
      });
    const { user } = renderCard();
    await screen.findByRole('button', { name: 'Skip it' });

    decidedElsewhere = true;
    await user.click(screen.getByRole('button', { name: 'Skip it' }));

    expect(
      await screen.findByText(
        'This step no longer waits for a decision — the run continues shortly.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Skip it' })).toBeNull();
  });

  it('keeps a refusal with the attempt it was about', async () => {
    let next = false;
    door.read = () =>
      answerWith(200, {
        inDoubt: attemptRow(next ? 'attempt-b' : 'attempt-a', {
          nodeId: next ? 'post_receipt' : 'send_invoice',
        }),
      });
    door.decide = () =>
      answerWith(403, {
        error: 'RBAC_FORBIDDEN',
        message: 'Editor role required',
      });
    const { user, client } = renderCard();

    await user.click(await screen.findByRole('button', { name: 'Skip it' }));
    expect(await screen.findByText('Editor role required')).toBeVisible();

    next = true;
    await client.invalidateQueries();
    expect(
      await screen.findByText('This step may already have run: post_receipt'),
    ).toBeVisible();
    expect(screen.queryByText('Editor role required')).toBeNull();
    expect(screen.queryByText("Couldn't record your choice.")).toBeNull();
  });
});
