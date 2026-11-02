import { Dialog } from '@tale/ui/dialog/dialog';
import { Toaster } from '@tale/ui/toaster';
import { act, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POLL_FAST_MS } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { errorText } from '@/tests/utils/errors';
import { navigate } from '@/tests/utils/sessions-router';

import { useProxyFlow } from '../hooks/use-proxy-flow';
import { ProxyFlowProvider } from './proxy-flow-provider';

/** The server's answer to a start or a rotation: the session, busy now. */
const busy = (overrides: Partial<Session> = {}) =>
  session({ status: 'starting', activity: 'assigning_proxy', ...overrides });

/** The answers of a route, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

const imported = {
  added: [proxy({ id: 20 })],
  duplicates: [],
  errors: [],
  summary: 'Added 1',
};

/** What the controls of a page do with the flows, as the page's buttons do. */
function Page({ target = session() }: { target?: Session }) {
  const flow = useProxyFlow();
  return (
    <>
      <button type="button" onClick={() => void flow.start(target)}>
        Start
      </button>
      <button type="button" onClick={() => void flow.rotate(target)}>
        Rotate
      </button>
      <button
        type="button"
        onClick={() => void flow.rotate(target, { thenStart: true })}
      >
        Rotate and start
      </button>
      <button
        type="button"
        onClick={() => void flow.create({ name: 'Shop', os: 'linux' })}
      >
        Create
      </button>
      <button type="button" onClick={() => void flow.addProxiesFor(target)}>
        Add proxies
      </button>
      <output>
        {flow.isStarting(target.id) ? 'starting' : 'not starting'}
        {' · '}
        {flow.isRotating(target.id) ? 'rotating' : 'not rotating'}
      </output>
    </>
  );
}

function renderFlow(page = <Page />) {
  return renderApp(
    <ProxyFlowProvider>
      {page}
      <Toaster />
    </ProxyFlowProvider>,
  );
}

const press = (name: string) => screen.getByRole('button', { name });

async function addProxies(user: ReturnType<typeof renderFlow>['user']) {
  await user.click(
    screen.getByRole('textbox', { name: 'Proxies, one per line' }),
  );
  await user.paste('198.51.100.20:8080');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Add proxies',
    }),
  );
}

const pollsOf = (api: ReturnType<typeof installFakeApi>, id = 1) =>
  api.callsTo(`GET /sessions/${id}`).length;

beforeEach(() => {
  navigate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('starting a session', () => {
  it('starts it, shows its page and goes on looking at it until its work is over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'POST /sessions/:id/start': busy({ activity: 'launching' }),
      'GET /sessions/:id': sequence(
        busy({ activity: 'launching' }),
        session({ status: 'running' }),
      ),
    });
    const { user } = renderFlow();

    await user.click(press('Start'));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '1' },
      }),
    );
    expect(api.callsTo('POST /sessions/:id/start')[0]?.body).toEqual({
      force: false,
    });
    await waitFor(() => expect(pollsOf(api)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));
    await waitFor(() => expect(pollsOf(api)).toBe(2));
    // It runs: there is nothing more to look at.
    const seen = pollsOf(api);
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 4));
    expect(pollsOf(api)).toBe(seen);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says it is starting while the request is under way', async () => {
    let answer: (value: Session) => void = () => {};
    installFakeApi({
      'POST /sessions/:id/start': () =>
        new Promise<Session>((resolve) => {
          answer = resolve;
        }),
      'GET /sessions/:id': session({ status: 'running' }),
    });
    const { user } = renderFlow();
    expect(screen.getByRole('status')).toHaveTextContent('not starting');

    await user.click(press('Start'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('starting'),
    );

    answer(busy());
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('not starting'),
    );
  });

  it('tells any other refusal once, as a toast, and opens nothing', async () => {
    installFakeApi({
      'POST /sessions/:id/start': failure(409, 'session_busy'),
    });
    const { user } = renderFlow();

    await user.click(press('Start'));

    expect(await screen.findByText("Couldn't start the session")).toBeVisible();
    expect(screen.getAllByText(errorText('session_busy'))).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('when no proxy is free', () => {
    it('opens the form that adds proxies, and starts the session by itself once there are some', async () => {
      const api = installFakeApi({
        'POST /sessions/:id/start': sequence(
          failure(409, 'no_free_proxy'),
          busy({ activity: 'launching' }),
        ),
        'POST /proxies/import': imported,
        'GET /sessions/:id': session({ status: 'running' }),
      });
      const { user } = renderFlow();

      await user.click(press('Start'));

      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        'Add proxies and the session will start automatically.',
      );
      // No toast: the dialog is the answer to the refusal.
      expect(screen.queryByText("Couldn't start the session")).toBeNull();
      expect(navigate).not.toHaveBeenCalled();

      await addProxies(user);

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
      );
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(screen.getByText('1 proxy added')).toBeVisible();
    });

    it('opens the form again when the server still has no free proxy', async () => {
      installFakeApi({
        'POST /sessions/:id/start': sequence(
          failure(409, 'no_free_proxy'),
          failure(409, 'no_free_proxy'),
          busy(),
        ),
        'POST /proxies/import': imported,
        'GET /sessions/:id': session({ status: 'running' }),
      });
      const { user } = renderFlow();
      await user.click(press('Start'));
      await screen.findByRole('dialog', { name: 'No free proxy available' });
      await addProxies(user);

      // Closed, and opened for the second refusal.
      await waitFor(() =>
        expect(screen.getAllByRole('dialog')).toHaveLength(1),
      );
      await addProxies(user);

      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    });

    it('gives up quietly on Cancel: nothing is started, nothing is told', async () => {
      const api = installFakeApi({
        'POST /sessions/:id/start': failure(409, 'no_free_proxy'),
      });
      const { user } = renderFlow();
      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      expect(screen.queryByText("Couldn't start the session")).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(press('Start')).toHaveFocus();
    });
  });

  describe('when another running session exits through the same IP', () => {
    const shared = failure(409, 'ip_in_use', 'x', {
      exitIp: '203.0.113.7',
      sessions: [{ id: 2, name: 'Shop', status: 'running' }],
    });

    it('asks, and starts anyway when told to', async () => {
      const api = installFakeApi({
        'POST /sessions/:id/start': ({ body }) =>
          typeof body === 'object' &&
          body !== null &&
          'force' in body &&
          body.force === true
            ? busy({ activity: 'launching' })
            : shared,
        'GET /sessions/:id': session({ status: 'running' }),
      });
      const { user } = renderFlow();

      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog', {
        name: 'Same exit IP as another session',
      });
      expect(screen.queryByText("Couldn't start the session")).toBeNull();
      await user.click(
        within(dialog).getByRole('button', { name: 'Start anyway' }),
      );

      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(
        api.callsTo('POST /sessions/:id/start').map((call) => call.body),
      ).toEqual([{ force: false }, { force: true }]);
    });

    it('leaves the session stopped on Cancel', async () => {
      const api = installFakeApi({ 'POST /sessions/:id/start': shared });
      const { user } = renderFlow();
      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('gives the session another proxy first on Rotate IP, and starts it once it has one', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = installFakeApi({
        'POST /sessions/:id/start': sequence(shared, busy()),
        'POST /sessions/:id/rotate': busy({ status: 'stopped' }),
        'GET /sessions/:id': sequence(
          busy({ status: 'stopped' }),
          session({ status: 'stopped' }),
        ),
      });
      const { user } = renderFlow();
      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      // The proxy is being assigned: the start waits for it.
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
      );
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    });
  });

  describe('when its own proxy does not work', () => {
    const broken = failure(502, 'proxy_unreachable', 'x', {
      proxyId: 3,
      reason: 'Proxy refused the credentials (407)',
    });

    it('asks whether to give it another one, and does not tell it as a toast', async () => {
      installFakeApi({ 'POST /sessions/:id/start': broken });
      const { user } = renderFlow();

      await user.click(press('Start'));

      expect(
        await screen.findByRole('dialog', {
          name: 'The proxy of "0001" isn\'t working',
        }),
      ).toBeVisible();
      expect(screen.queryByText("Couldn't start the session")).toBeNull();
    });

    it('rotates the proxy and starts the session afterwards on Rotate IP', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = installFakeApi({
        'POST /sessions/:id/start': sequence(broken, busy()),
        'POST /sessions/:id/rotate': busy({ status: 'stopped' }),
        'GET /sessions/:id': sequence(
          busy({ status: 'stopped' }),
          session({ status: 'stopped' }),
        ),
      });
      const { user } = renderFlow();
      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
      await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
      );
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    });

    it('leaves the session as it is on Cancel', async () => {
      const api = installFakeApi({ 'POST /sessions/:id/start': broken });
      const { user } = renderFlow();
      await user.click(press('Start'));
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(0);
      expect(press('Start')).toHaveFocus();
    });
  });
});

describe('giving a session another proxy', () => {
  it('rotates it, and leaves it stopped when it was not asked to start', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'POST /sessions/:id/rotate': busy({ status: 'stopped' }),
      'GET /sessions/:id': sequence(
        busy({ status: 'stopped' }),
        session({ status: 'stopped' }),
      ),
    });
    const { user } = renderFlow();

    await user.click(press('Rotate'));
    await waitFor(() => expect(pollsOf(api)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));

    expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('starts the session once it has its new proxy when asked to', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'POST /sessions/:id/rotate': busy({ status: 'stopped' }),
      'POST /sessions/:id/start': busy({ activity: 'launching' }),
      'GET /sessions/:id': sequence(
        busy({ status: 'stopped' }),
        session({ status: 'stopped' }),
        session({ status: 'running' }),
      ),
    });
    const { user } = renderFlow();

    await user.click(press('Rotate and start'));
    await waitFor(() => expect(pollsOf(api)).toBe(1));
    // Still assigning: not yet.
    expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });

  it('says it is rotating while the request is under way', async () => {
    let answer: (value: Session) => void = () => {};
    installFakeApi({
      'POST /sessions/:id/rotate': () =>
        new Promise<Session>((resolve) => {
          answer = resolve;
        }),
      'GET /sessions/:id': session({ status: 'stopped' }),
    });
    const { user } = renderFlow();

    await user.click(press('Rotate'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('rotating'),
    );

    answer(session());
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('not rotating'),
    );
  });

  it('asks for proxies when none is free, and rotates by itself when there are some', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/rotate': sequence(
        failure(409, 'no_free_proxy'),
        busy({ status: 'stopped' }),
      ),
      'POST /proxies/import': imported,
      'GET /sessions/:id': session({ status: 'stopped' }),
    });
    const { user } = renderFlow();

    await user.click(press('Rotate'));
    const dialog = await screen.findByRole('dialog', {
      name: 'No free proxy available',
    });
    expect(dialog).toHaveTextContent(
      'Add proxies and the session will switch to one of them automatically.',
    );
    await addProxies(user);

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(2),
    );
    expect(screen.queryByText("Couldn't rotate the IP")).toBeNull();
  });
});

describe('adding a session', () => {
  it('creates it and opens it', async () => {
    const api = installFakeApi({
      'POST /sessions': busy({ id: 9, name: 'Shop' }),
      'GET /sessions/:id': session({ id: 9, status: 'running' }),
    });
    const { user } = renderFlow();

    await user.click(press('Create'));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '9' },
      }),
    );
    expect(api.callsTo('POST /sessions')[0]?.body).toEqual({
      name: 'Shop',
      os: 'linux',
    });
  });

  it('asks for proxies when none is free, and creates the session with the same name and system once there are some', async () => {
    const api = installFakeApi({
      'POST /sessions': sequence(
        failure(409, 'no_free_proxy'),
        busy({ id: 9, name: 'Shop' }),
      ),
      'POST /proxies/import': imported,
      'GET /sessions/:id': session({ id: 9, status: 'running' }),
    });
    const { user } = renderFlow();

    await user.click(press('Create'));
    const dialog = await screen.findByRole('dialog', {
      name: 'No free proxy available',
    });
    expect(dialog).toHaveTextContent(
      'Add proxies and the session will be added automatically.',
    );
    await addProxies(user);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/sessions/$sessionId',
        params: { sessionId: '9' },
      }),
    );
    expect(api.callsTo('POST /sessions').map((call) => call.body)).toEqual([
      { name: 'Shop', os: 'linux' },
      { name: 'Shop', os: 'linux' },
    ]);
  });

  it('tells a name that was taken meanwhile, once, because the dialog that had it is gone', async () => {
    installFakeApi({
      'POST /sessions': sequence(
        failure(409, 'no_free_proxy'),
        failure(409, 'name_taken'),
      ),
      'POST /proxies/import': imported,
    });
    const { user } = renderFlow();
    await user.click(press('Create'));
    await screen.findByRole('dialog');
    await addProxies(user);

    expect(await screen.findByText("Couldn't add the session")).toBeVisible();
    expect(screen.getByText(errorText('name_taken'))).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('work the server does in the background', () => {
  const stuck = (overrides: Partial<Session> = {}) =>
    session({
      status: 'error',
      error: 'No working proxy available',
      errorCode: 'no_working_proxy',
      ...overrides,
    });

  it('asks for proxies when the session ends because none worked, and starts it again once they are added', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'GET /meta': meta({ counts: { proxies: 3, failedProxies: 3 } }),
      'POST /sessions/:id/start': busy(),
      'POST /proxies/import': imported,
      'GET /sessions/:id': sequence(busy(), stuck({ name: 'Shop' })),
    });
    const { user } = renderFlow(<Page target={session({ name: 'Shop' })} />);
    await user.click(press('Start'));
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

    const dialog = await screen.findByRole('dialog', {
      name: 'No working proxy available',
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent('3 proxies failed their check.'),
    );
    expect(dialog).toHaveTextContent(
      'Once you add proxies, the session "Shop" gets one of them automatically.',
    );
    await addProxies(user);

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
    );
  });

  it('starts nothing when the person gives up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': stuck(),
    });
    const { user } = renderFlow();
    await user.click(press('Start'));

    const dialog = await screen.findByRole('dialog', {
      name: 'No working proxy available',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));
    expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
    // And it does not ask a second time for the same end.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puts every session that ended that way in one dialog, and starts each again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Both are being started; the work of both ends before the next look.
    let over = false;
    const api = installFakeApi({
      'GET /meta': meta({ counts: { proxies: 2, failedProxies: 2 } }),
      'POST /sessions/:id/start': ({ params }) =>
        busy({ id: Number(params.id) }),
      'POST /proxies/import': imported,
      'GET /sessions/:id': ({ params }) => {
        const id = Number(params.id);
        return over
          ? stuck({ id, name: id === 1 ? 'Shop' : 'Bank' })
          : busy({ id });
      },
    });
    const { user } = renderFlow(
      <>
        <Page target={session({ id: 1, name: 'Shop' })} />
        <Page target={session({ id: 2, name: 'Bank' })} />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Start' });
    if (first === undefined || second === undefined) {
      throw new Error('a button is missing');
    }
    await user.click(first);
    await user.click(second);
    // (The start of the second refreshed the first as well.)
    await waitFor(() => expect(pollsOf(api, 1)).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(pollsOf(api, 2)).toBeGreaterThanOrEqual(1));
    over = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

    const dialog = await screen.findByRole('dialog', {
      name: 'No working proxy available',
    });
    await waitFor(() =>
      expect(dialog).toHaveTextContent(
        'Once you add proxies, the sessions "Shop" and "Bank" get one of them automatically.',
      ),
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await addProxies(user);

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(4),
    );
  });

  it('takes no account of what was known before the work began', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The session failed an hour ago, and a page still has it so in its cache.
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': sequence(busy(), session({ status: 'running' })),
    });
    const { user, queryClient } = renderFlow();
    queryClient.setQueryData(['sessions', 'one', 1], stuck());
    await user.click(press('Start'));
    await waitFor(() => expect(pollsOf(api)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 2));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets it be, when the session ended some other way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': session({
        status: 'error',
        error: 'Camoufox exited with code 9',
        errorCode: null,
      }),
    });
    const { user } = renderFlow();
    await user.click(press('Start'));
    await waitFor(() => expect(pollsOf(api)).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1);
  });

  it('drops a session that was deleted meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = installFakeApi({
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': failure(404, 'session_not_found'),
    });
    const { user } = renderFlow();
    await user.click(press('Start'));
    await waitFor(() => expect(pollsOf(api)).toBe(1));

    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));

    expect(pollsOf(api)).toBe(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('waits while another dialog is open, and asks once it is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': sequence(busy(), stuck()),
    });
    let setOther: (open: boolean) => void = () => {};
    function Other() {
      const [open, setOpen] = useState(false);
      useEffect(() => {
        setOther = setOpen;
      }, []);
      return (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Rename"
          description="A name"
        />
      );
    }
    const { user } = renderFlow(
      <>
        <Page />
        <Other />
      </>,
    );
    await user.click(press('Start'));
    // The person opens another dialog while the session is being started.
    act(() => setOther(true));

    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));
    expect(screen.queryByText('No working proxy available')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    act(() => setOther(false));
    await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS));

    expect(
      await screen.findByRole('dialog', { name: 'No working proxy available' }),
    ).toBeVisible();
  });
});

describe('one dialog at a time', () => {
  it('shows the next dialog only once the person answered the one before', async () => {
    installFakeApi({
      'POST /sessions/:id/start': failure(409, 'no_free_proxy'),
      'POST /sessions/:id/rotate': failure(409, 'no_free_proxy'),
    });
    const { user } = renderFlow();

    await user.click(press('Start'));
    await screen.findByRole('dialog', { name: 'No free proxy available' });
    // The second one is asked for behind the first, with the page out of reach.
    await act(async () => {
      screen.getByRole('button', { name: 'Rotate', hidden: true }).click();
    });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'the session will start automatically',
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent(
        'the session will switch to one of them automatically',
      ),
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('a session without a working proxy', () => {
  it('asks for proxies for it, and starts it once they are added', async () => {
    const api = installFakeApi({
      'GET /meta': meta({ counts: { proxies: 1, failedProxies: 1 } }),
      'POST /proxies/import': imported,
      'POST /sessions/:id/start': busy(),
      'GET /sessions/:id': session({ status: 'running' }),
    });
    const { user } = renderFlow(<Page target={session({ name: 'Shop' })} />);

    await user.click(press('Add proxies'));
    await screen.findByRole('dialog', { name: 'No working proxy available' });
    await addProxies(user);

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
    );
  });
});

describe('across pages', () => {
  it('goes on with the flow when the page that began it is gone', async () => {
    const api = installFakeApi({
      'POST /sessions/:id/start': sequence(
        failure(409, 'no_free_proxy'),
        busy(),
      ),
      'POST /proxies/import': imported,
      'GET /sessions/:id': session({ status: 'running' }),
    });
    let leave: () => void = () => {};
    function Pages() {
      const [here, setHere] = useState(true);
      useEffect(() => {
        leave = () => setHere(false);
      }, []);
      return here ? <Page /> : <p>Another page</p>;
    }
    const { user } = renderFlow(<Pages />);
    await user.click(press('Start'));
    await screen.findByRole('dialog', { name: 'No free proxy available' });

    // The person goes elsewhere while the dialog is up (the app's own link).
    act(() => leave());
    expect(screen.getByText('Another page')).toBeInTheDocument();
    await addProxies(user);

    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(2),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
  });
});

describe('outside the provider', () => {
  it('says what is missing instead of failing in the dark', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderApp(<Page />)).toThrow(/ProxyFlowProvider/);
  });
});
