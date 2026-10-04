// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import { i18n } from '@/lib/i18n/i18n';
import {
  type ShippedLocale,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { RunApprovalCard } from './run-approval-card';

// The card runs its real lane end to end: `useRunApproval` and
// `useResolveRunApproval`, `useBackendQuery`/`useBackendMutation`, the
// adapter rows, `backendFetch` and react-query. Only the session probe and
// the network are synthetic: `fetch` answers the approvals door the way the
// backend does, and `EventSource` is an inert emitter the real hint hook
// listens to.
vi.mock('@/app/hooks/use-session-user', () => ({
  useSessionUser: () => ({ isLoading: false, isAuthenticated: true }),
}));

const ORG = 'org-1';

/** An approval as `GET /api/app/approvals/:id` answers it. */
function approvalRow(
  id: string,
  recipient: string,
  status = 'pending',
): Record<string, unknown> {
  return {
    id,
    organizationId: ORG,
    resourceType: 'connector_operation',
    resourceId: `run-1:${id}`,
    priority: 'medium',
    status,
    metadata: {
      connector: 'gmail',
      action: 'send',
      nodeId: 'send',
      runId: 'run-1',
      parameters: { to: recipient },
    },
    createdAt: 1_790_000_000_000,
  };
}

type Answer = Response | Promise<Response>;
interface Door {
  read: Map<string, () => Answer>;
  decide: Map<string, (body: unknown) => Answer>;
  calls: { method: string; path: string; body: unknown }[];
}
let door: Door;

function answerWith(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/** An approval the door reads back as decided once its decide answered 200. */
function decidable(id: string, recipient: string): void {
  let decided: string | null = null;
  door.read.set(id, () =>
    answerWith(200, approvalRow(id, recipient, decided ?? 'pending')),
  );
  door.decide.set(id, (body) => {
    const status =
      body !== null && typeof body === 'object' && 'status' in body
        ? String(body.status)
        : 'pending';
    decided = status;
    return answerWith(200, { ok: true });
  });
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  private readonly listeners = new Map<
    string,
    Set<(e: MessageEvent) => void>
  >();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: (e: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data = ''): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

const hints = () => FakeEventSource.instances.at(-1);

beforeEach(() => {
  // A run page of the organization: the decide write takes its organization
  // from the route, as it does in the app.
  window.history.pushState(
    {},
    '',
    `/dashboard/${ORG}/automations/x/runs/run-1`,
  );
  door = { read: new Map(), decide: new Map(), calls: [] };
  FakeEventSource.instances = [];
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
    const decide = /^\/api\/app\/approvals\/([^/]+)\/decide$/.exec(
      url.pathname,
    );
    if (method === 'POST' && decide) {
      const handler = door.decide.get(decide[1] ?? '');
      if (handler) return handler(body);
    }
    const read = /^\/api\/app\/approvals\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && read) {
      const handler = door.read.get(read[1] ?? '');
      if (handler) return handler();
      return answerWith(404, {
        error: 'NOT_FOUND',
        message: 'Approval not found',
      });
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

function renderCard(approvalId: string) {
  // The approval read's own retries, shortened: a transient failure is
  // retried three times before the card reports it.
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 1 } },
  });
  const tree = (id: string | null): ReactElement => (
    <QueryClientProvider client={client}>
      <Hints />
      {id !== null && <RunApprovalCard organizationId={ORG} approvalId={id} />}
    </QueryClientProvider>
  );
  const view = render(tree(approvalId));
  return {
    ...view,
    client,
    /** The same card, now for another approval. */
    show: (id: string) => view.rerender(tree(id)),
    /** No card at all (the run moved on to something else). */
    hide: () => view.rerender(tree(null)),
  };
}

const decides = () =>
  door.calls.filter((call) => call.path.endsWith('/decide'));
const reads = (id: string) =>
  door.calls.filter(
    (call) => call.method === 'GET' && call.path.endsWith(`/${id}`),
  );

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

describe('RunApprovalCard — the approval read', () => {
  it('says the run waits while the approval loads, offering nothing to press', async () => {
    const answer = deferred();
    door.read.set('approval-a', () => answer.promise);
    renderCard('approval-a');

    expect(await screen.findByText('Waiting for approval')).toBeVisible();
    expect(
      screen.getByRole('status', { name: 'Loading the approval…' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();

    answer.resolve(
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    expect(
      await screen.findByRole('button', { name: 'Approve' }),
    ).toBeEnabled();
  });

  // #3707: the read failed after its retries, and the card rendered nothing —
  // no decision, no failure, no way back.
  it('keeps the waiting explanation and offers Try again after a failed read', async () => {
    let up = false;
    door.read.set('approval-a', () =>
      up
        ? answerWith(200, approvalRow('approval-a', 'client-a@example.test'))
        : answerWith(503, { error: 'unavailable' }),
    );
    const { user } = renderCard('approval-a');

    expect(
      await screen.findByText("Couldn't load this approval."),
    ).toBeVisible();
    expect(screen.getByText('Waiting for approval')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    // A fault carries no words of its own: nothing technical is shown.
    expect(screen.queryByText(/unavailable|503/)).toBeNull();
    expect(reads('approval-a')).toHaveLength(4);

    up = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('button', { name: 'Approve' }),
    ).toBeEnabled();
    expect(await screen.findByText(/client-a@example\.test/)).toBeVisible();
    expect(screen.queryByText("Couldn't load this approval.")).toBeNull();
  });

  it('falls back to the plain waiting banner when no such approval exists', async () => {
    renderCard('approval-gone');

    const banner = await screen.findByRole('alert');
    expect(banner).toBeVisible();
    expect(banner).toHaveTextContent('Waiting for approval');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it.each<[ShippedLocale, string, string, string]>([
    [
      'de',
      'Wartet auf Freigabe',
      'Diese Freigabe konnte nicht geladen werden.',
      'Erneut versuchen',
    ],
    [
      'fr',
      'En attente d’approbation',
      'Impossible de charger cette approbation.',
      'Réessayer',
    ],
  ])('says it in %s', async (locale, waiting, failed, retry) => {
    saveLocale(locale);
    await i18n.changeLanguage(locale);
    door.read.set('approval-a', () =>
      answerWith(503, { error: 'unavailable' }),
    );
    renderCard('approval-a');

    expect(await screen.findByText(failed)).toBeVisible();
    expect(screen.getByText(waiting)).toBeVisible();
    expect(screen.getByRole('button', { name: retry })).toBeVisible();
  });
});

describe('RunApprovalCard — the decision', () => {
  // Without the approval hint (a dropped stream, a slow poller) the card
  // kept offering Approve and Reject after the door answered 200.
  it('shows an accepted approval as approved at once', async () => {
    decidable('approval-a', 'client-a@example.test');
    const { user } = renderCard('approval-a');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(
      await screen.findByText(
        'gmail.send approved — the run resumes on its next poll.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(decides()).toEqual([
      {
        method: 'POST',
        path: '/api/app/approvals/approval-a/decide',
        body: { status: 'executing' },
      },
    ]);
  });

  // Someone else decided first. The door's refusal is right, but the card
  // kept offering the decision beside "This approval is already executing";
  // it now reads the approval back and shows the decision on record.
  it('shows the decision on record after another session decided first', async () => {
    let decidedElsewhere = false;
    door.read.set('approval-a', () =>
      answerWith(
        200,
        approvalRow(
          'approval-a',
          'client-a@example.test',
          decidedElsewhere ? 'executing' : 'pending',
        ),
      ),
    );
    door.decide.set('approval-a', () =>
      answerWith(409, {
        error: 'ALREADY_RESOLVED',
        message: 'This approval is already executing',
      }),
    );
    const { user } = renderCard('approval-a');
    await screen.findByRole('button', { name: 'Reject' });

    decidedElsewhere = true;
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(
      await screen.findByText(
        'gmail.send approved — the run resumes on its next poll.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.queryByText(/already executing/)).toBeNull();
  });

  it('keeps the decision open after a failed write, and the same press retries it', async () => {
    let attempts = 0;
    door.read.set('approval-a', () =>
      answerWith(
        200,
        approvalRow(
          'approval-a',
          'client-a@example.test',
          attempts > 1 ? 'executing' : 'pending',
        ),
      ),
    );
    door.decide.set('approval-a', () => {
      attempts += 1;
      return attempts === 1
        ? answerWith(500, { error: 'Internal Server Error' })
        : answerWith(200, { ok: true });
    });
    const { user } = renderCard('approval-a');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText("Couldn't record your decision."),
    ).toBeVisible();
    // A fault's payload is not the reader's to read.
    expect(screen.queryByText(/status 500|Internal Server Error/)).toBeNull();
    const approve = screen.getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(approve).toBeEnabled());

    await user.click(approve);
    expect(
      await screen.findByText(
        'gmail.send approved — the run resumes on its next poll.',
      ),
    ).toBeVisible();
    expect(decides()).toHaveLength(2);
  });

  it('puts a refusal in its own words under a sentence of its own', async () => {
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    door.decide.set('approval-a', () =>
      answerWith(403, {
        error: 'FORBIDDEN',
        message: 'Only org admins decide erasure approvals.',
      }),
    );
    const { user } = renderCard('approval-a');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(
      await screen.findByText("Couldn't record your decision."),
    ).toBeVisible();
    expect(
      screen.getByText('Only org admins decide erasure approvals.'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});

// #3721: the refusal of approval A stayed on screen when the same card went
// on to show approval B — the run's next gate, or another task's run in the
// same panel — though B was never submitted.
describe('RunApprovalCard — one approval at a time', () => {
  beforeEach(() => {
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    door.read.set('approval-b', () =>
      answerWith(200, approvalRow('approval-b', 'client-b@example.test')),
    );
  });

  it('shows the next approval without the refusal of the previous one', async () => {
    door.decide.set('approval-a', () =>
      answerWith(409, {
        error: 'APPROVAL_REFUSED',
        message: 'Approval A was refused',
      }),
    );
    const { user, show } = renderCard('approval-a');
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText('Approval A was refused');

    show('approval-b');

    expect(await screen.findByText(/client-b@example\.test/)).toBeVisible();
    expect(screen.queryByText(/client-a@example\.test/)).toBeNull();
    expect(screen.queryByText('Approval A was refused')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(decides().map((call) => call.path)).toEqual([
      '/api/app/approvals/approval-a/decide',
    ]);
  });

  it('lets no late answer for the previous approval reach the next one', async () => {
    const lateA = deferred();
    door.decide.set('approval-a', () => lateA.promise);
    const { user, show } = renderCard('approval-a');
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    show('approval-b');
    await screen.findByText(/client-b@example\.test/);
    // B was never pressed: A's press in flight does not hold its verbs.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();

    lateA.resolve(
      answerWith(409, {
        error: 'ALREADY_RESOLVED',
        message: 'This approval is already rejected',
      }),
    );
    await waitFor(() =>
      expect(
        door.calls.filter((call) => call.path.endsWith('/decide')),
      ).toHaveLength(1),
    );
    await act(async () => {
      await lateA.promise;
    });
    expect(screen.queryByText(/already rejected/)).toBeNull();
    expect(screen.queryByText("Couldn't record your decision.")).toBeNull();
    expect(screen.getByText(/client-b@example\.test/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});

// The issues' controls — behaviour that was already right and must stay so.
// They pass on the previous card as well.
describe('RunApprovalCard — controls', () => {
  it('renders the exact operation, its input and both decisions for a pending read', async () => {
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    renderCard('approval-a');

    expect(
      await screen.findByText('Waiting for your approval: gmail.send'),
    ).toBeVisible();
    expect(await screen.findByText(/client-a@example\.test/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  // Reads that failed on a fault refetch by themselves when the hint stream
  // opens again (2026-09-26 evaluation, G-07) — the card rides that recovery.
  it('comes back on its own when the hint stream reopens', async () => {
    let up = false;
    door.read.set('approval-a', () =>
      up
        ? answerWith(200, approvalRow('approval-a', 'client-a@example.test'))
        : answerWith(503, { error: 'unavailable' }),
    );
    renderCard('approval-a');
    await waitFor(() => expect(reads('approval-a')).toHaveLength(4));
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 20));
    });

    up = true;
    act(() => {
      hints()?.emit('open');
    });
    expect(
      await screen.findByRole('button', { name: 'Approve' }),
    ).toBeEnabled();
  });

  it('shows the approved state once the approval hint arrives', async () => {
    decidable('approval-a', 'client-a@example.test');
    const { user } = renderCard('approval-a');

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(decides()).toHaveLength(1));
    act(() => {
      hints()?.emit(
        'hint',
        JSON.stringify({ entity: 'approval', entityId: 'approval-a' }),
      );
    });

    expect(
      await screen.findByText(
        'gmail.send approved — the run resumes on its next poll.',
      ),
    ).toBeVisible();
  });

  it('holds both verbs while a press is in flight', async () => {
    const answer = deferred();
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    door.decide.set('approval-a', () => answer.promise);
    const { user } = renderCard('approval-a');

    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(decides()).toHaveLength(1);

    answer.resolve(answerWith(200, { ok: true }));
    await waitFor(() =>
      expect(document.querySelector('[aria-busy="true"]')).toBeNull(),
    );
    expect(decides()).toHaveLength(1);
  });

  it('keeps a late answer for an approval that left the screen away from the next one', async () => {
    const lateA = deferred();
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'client-a@example.test')),
    );
    door.read.set('approval-b', () =>
      answerWith(200, approvalRow('approval-b', 'client-b@example.test')),
    );
    door.decide.set('approval-a', () => lateA.promise);
    const { user, hide, show } = renderCard('approval-a');
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    hide();
    show('approval-b');
    await screen.findByText(/client-b@example\.test/);
    lateA.resolve(
      answerWith(409, {
        error: 'ALREADY_RESOLVED',
        message: 'This approval is already rejected',
      }),
    );
    await act(async () => {
      await lateA.promise;
    });

    expect(screen.queryByText(/already rejected/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});

describe('RunApprovalCard — keyboard recovery', () => {
  it.each([false, true])(
    'restores a stranded retry focus, preserving a deliberate move: %s',
    async (moveFocus) => {
      const retryAnswer = deferred();
      let retrying = false;
      door.read.set('approval-a', () =>
        retrying
          ? retryAnswer.promise.then((response) => response.clone())
          : answerWith(503, { error: 'unavailable' }),
      );
      const { user } = renderCard('approval-a');
      render(<button type="button">Another action</button>);
      const another = screen.getByRole('button', { name: 'Another action' });
      const retry = await screen.findByRole('button', { name: 'Try again' });
      retry.focus();
      expect(retry).toHaveFocus();

      retrying = true;
      await user.keyboard('{Enter}');
      await waitFor(() => expect(retry.isConnected).toBe(false));
      if (moveFocus) {
        await user.tab();
        expect(another).toHaveFocus();
      }

      retryAnswer.resolve(answerWith(503, { error: 'unavailable' }));
      const replacement = await screen.findByRole('button', {
        name: 'Try again',
      });
      await waitFor(() =>
        expect(moveFocus ? another : replacement).toHaveFocus(),
      );
    },
  );

  it('does not hand retry focus to another approval after changing cards', async () => {
    const retryAnswer = deferred();
    let retrying = false;
    door.read.set('approval-a', () =>
      retrying
        ? retryAnswer.promise.then((response) => response.clone())
        : answerWith(503, { error: 'unavailable' }),
    );
    door.read.set('approval-b', () =>
      answerWith(503, { error: 'unavailable' }),
    );
    const { user, show } = renderCard('approval-a');
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    retrying = true;
    await user.keyboard('{Enter}');
    await waitFor(() => expect(retry.isConnected).toBe(false));

    show('approval-b');
    const replacement = await screen.findByRole('button', {
      name: 'Try again',
    });
    retryAnswer.resolve(answerWith(503, { error: 'unavailable' }));
    await act(async () => {
      await retryAnswer.promise;
    });
    expect(replacement).not.toHaveFocus();
  });

  it('keeps a late accepted decision for A away from approval B', async () => {
    const late = deferred();
    door.read.set('approval-a', () =>
      answerWith(200, approvalRow('approval-a', 'a@example.test')),
    );
    door.read.set('approval-b', () =>
      answerWith(200, approvalRow('approval-b', 'b@example.test')),
    );
    door.decide.set('approval-a', () => late.promise);
    const { user, show, client } = renderCard('approval-a');
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(client.isMutating()).toBe(1));

    show('approval-b');
    await screen.findByText(/b@example\.test/);
    late.resolve(answerWith(200, { ok: true }));
    await act(async () => {
      await late.promise;
    });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.queryByText(/approved —/)).toBeNull();
  });
});
