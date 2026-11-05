import { Toaster } from '@tale/ui/toaster';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SkipLink } from '@/app/components/layout/skip-link';
import { queryKeys } from '@/app/lib/api/keys';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi, list, listFor } from '@/tests/utils/fake-api';
import { meta, proxy, runningSession, session } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { errorText } from '@/tests/utils/errors';
import { navigate, setOpenPath } from '@/tests/utils/sessions-router';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { openSessionId, SessionList } from './session-list';

function named(id: number, overrides: Partial<Session> = {}): Session {
  return session({ id, name: String(id).padStart(4, '0'), ...overrides });
}

function renderList(onAdd = vi.fn(), onFocusLost = vi.fn()) {
  return {
    ...renderApp(
      <ProxyFlowProvider>
        <SessionList onAdd={onAdd} onFocusLost={onFocusLost} />
        <Toaster />
      </ProxyFlowProvider>,
    ),
    onAdd,
    onFocusLost,
  };
}

/** Pages like the backend: the newest `limit` sessions, from `minId` up, and the size of all. */
function paged(all: readonly Session[]) {
  return (request: { query: URLSearchParams }) => listFor(request.query, all);
}

/** The rows, top to bottom, each named by the session it lists. */
function expectRows(...names: string[]) {
  const links = screen.getAllByRole('link');
  expect(links).toHaveLength(names.length);
  names.forEach((name, index) =>
    expect(links[index]).toHaveAccessibleName(new RegExp(name)),
  );
}

// The test setup stands in for the scrolling jsdom cannot do. The list is
// never scrolled with it: see "keeping the open session in sight".
const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');

/** How high the list is on the screen in the tests that scroll it, and its rows. */
const LIST_HEIGHT = 600;
const ROW_HEIGHT = 48;

function rectBetween(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 260,
    x: 0,
    y: top,
    width: 260,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

/**
 * Lays the list out, which jsdom does not: a list `LIST_HEIGHT` high with its
 * rows one under the other, `ROW_HEIGHT` each, that move as the list scrolls.
 * Everything else is as jsdom has it, no size at all.
 */
function layOutList() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: Element) {
      const region = this.closest('[role="region"]');
      if (region === null) return rectBetween(0, 0);
      if (this === region) return rectBetween(0, LIST_HEIGHT);
      const at = Array.from(
        region.querySelectorAll('a[data-indicator-key]'),
      ).indexOf(this);
      if (at === -1) return rectBetween(0, 0);
      const top = at * ROW_HEIGHT - region.scrollTop;
      return rectBetween(top, top + ROW_HEIGHT);
    },
  );
}

/** The scroller of the list: the region that has the rows. */
function scrollerOfList() {
  return screen.getByRole('region', { name: 'Session list' });
}

/** An IntersectionObserver a test can tell that the end of the list is in view. */
function stubIntersectionObserver() {
  const live = new Set<StubObserver>();
  class StubObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly scrollMargin = '';
    readonly thresholds = [];
    target: Element | null = null;
    constructor(readonly callback: IntersectionObserverCallback) {
      live.add(this);
    }
    observe(target: Element) {
      this.target = target;
    }
    unobserve() {}
    disconnect() {
      live.delete(this);
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', StubObserver);
  return {
    observing: () => live.size,
    /** The end of the list scrolls into view. */
    reachEnd: () => {
      const observer = [...live].at(-1);
      const target = observer?.target;
      if (observer === undefined || target === undefined || target === null) {
        throw new Error('nothing watches the end of the list');
      }
      const box = target.getBoundingClientRect();
      act(() =>
        observer.callback(
          [
            {
              isIntersecting: true,
              target,
              boundingClientRect: box,
              intersectionRect: box,
              rootBounds: null,
              intersectionRatio: 1,
              time: 0,
            },
          ],
          observer,
        ),
      );
    },
  };
}

beforeEach(() => {
  navigate.mockClear();
  setOpenPath('/sessions');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openSessionId', () => {
  it('reads the session whose page the path is', () => {
    expect(openSessionId('/sessions/12')).toBe(12);
    expect(openSessionId('/sessions/12/')).toBe(12);
  });

  it('reads nothing from the other pages', () => {
    expect(openSessionId('/sessions')).toBeNull();
    expect(openSessionId('/proxies')).toBeNull();
    expect(openSessionId('/sessions/new')).toBeNull();
  });

  it('reads no session from an address that names none, as the session page does not', () => {
    // Leading zeros, zero and a number beyond what an id can be name no session.
    expect(openSessionId('/sessions/007')).toBeNull();
    expect(openSessionId('/sessions/0')).toBeNull();
    expect(openSessionId('/sessions/99999999999999999999')).toBeNull();
    expect(openSessionId('/sessions/1e3')).toBeNull();
  });
});

describe('SessionList', () => {
  describe('with sessions', () => {
    it('lists them as they come, newest first, each a link to its page', async () => {
      installFakeApi({
        'GET /meta': meta({ counts: { sessions: 3 } }),
        'GET /sessions': list([
          named(3, { name: 'Shop' }),
          named(2),
          named(1, { name: 'Bank' }),
        ]),
      });
      renderList();

      const region = await screen.findByRole('region', {
        name: 'Session list',
      });
      const links = await within(region).findAllByRole('link');
      expect(links.map((link) => link.getAttribute('href'))).toEqual([
        '/sessions/3',
        '/sessions/2',
        '/sessions/1',
      ]);
      expectRows('Shop', '0002', 'Bank');
    });

    it('marks the open session', async () => {
      setOpenPath('/sessions/2');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(3), named(2), named(1)]),
      });
      renderList();

      const links = await screen.findAllByRole('link');
      expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
        null,
        'page',
        null,
      ]);
    });

    it('shows every state at once: what each row says is its own', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([
          named(3, { status: 'error', errorCode: 'no_proxy' }),
          { ...runningSession(), id: 2, name: '0002' },
          named(1),
        ]),
      });
      renderList();

      const links = await screen.findAllByRole('link');
      expect(links[0]).toHaveTextContent(errorText('no_proxy'));
      expect(links[1]).toHaveTextContent('203.0.113.7 · DE');
      expect(links[2]).toHaveTextContent('Stopped');
    });

    it('ends in how many sessions there are', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(2), named(1)]),
      });
      renderList();
      expect(
        await screen.findByText('Showing all 2 sessions'),
      ).toBeInTheDocument();
    });

    it('counts a single session in the singular', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(1)]),
      });
      renderList();
      expect(
        await screen.findByText('Showing all 1 session'),
      ).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      setOpenPath('/sessions/2');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(3), named(2), runningSession()]),
      });
      const view = renderList();
      await screen.findAllByRole('link');
      await checkAccessibility(view);
    });
  });

  describe('while the first answer is awaited', () => {
    it('masks rows in place, announced once as loading', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => new Promise(() => {}),
      });
      const view = renderList();

      expect(
        screen.getByRole('status', { name: 'Loading content' }),
      ).toBeVisible();
      expect(screen.queryAllByRole('link')).toHaveLength(0);
      expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
      await checkAccessibility(view);
    });

    it('masks as many rows as the counts say there are sessions', async () => {
      installFakeApi({
        'GET /meta': meta({ counts: { sessions: 2, proxies: 2 } }),
        'GET /sessions': () => new Promise(() => {}),
      });
      renderList();

      // Six while nothing says how many, then the two that will come: a
      // masked row is a masked dot and its lines.
      await waitFor(() =>
        expect(
          screen
            .getByRole('status', { name: 'Loading content' })
            .querySelectorAll('[data-skeleton-mask="circle"]'),
        ).toHaveLength(2),
      );
    });

    it('says there are none at once when the counts say so, instead of masked rows that vanish when the list comes', async () => {
      installFakeApi({
        'GET /meta': meta({ counts: { sessions: 0, proxies: 2 } }),
        // The list never comes: the counts alone decide.
        'GET /sessions': () => new Promise(() => {}),
      });
      renderList();

      expect(
        await screen.findByRole('heading', { name: 'No sessions yet' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('status', { name: 'Loading content' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add session' })).toBeVisible();
    });
  });

  describe('with no sessions', () => {
    it('says so, and offers to add the first', async () => {
      installFakeApi({
        'GET /meta': meta({ counts: { proxies: 3 } }),
        'GET /sessions': list([]),
      });
      const { user, onAdd } = renderList();

      expect(
        await screen.findByRole('heading', { name: 'No sessions yet' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'Add a session to get an isolated browser with a profile and proxy of its own.',
        ),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Add session' }),
        ).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: 'Add session' }));
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it('stays masked until it knows how many proxies there are, so the empty list says the right thing at once', async () => {
      installFakeApi({
        'GET /meta': () => new Promise(() => {}),
        'GET /sessions': list([]),
      });
      const { queryClient } = renderList();

      // The list has answered; the proxies have not.
      await waitFor(() =>
        expect(
          queryClient.getQueryData(queryKeys.sessionList(50)),
        ).toBeDefined(),
      );
      expect(
        screen.getByRole('status', { name: 'Loading content' }),
      ).toBeVisible();
      expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add session' })).toBeNull();
    });

    describe('when there are no proxies', () => {
      /** The pool the page sees, and the sessions: adding proxies changes the first. */
      function serve(initialProxies = 0) {
        const state = { proxies: initialProxies };
        installFakeApi({
          'GET /meta': () => meta({ counts: { proxies: state.proxies } }),
          'GET /sessions': list([]),
          'POST /proxies/import': () => {
            state.proxies += 2;
            return {
              added: [proxy({ id: 1 }), proxy({ id: 2 })],
              duplicates: [],
              errors: [],
              summary: 'Added 2',
            };
          },
        });
        return state;
      }

      it('says every session needs a proxy, and offers to add them right there', async () => {
        serve();
        renderList();

        expect(
          await screen.findByText(
            'Add proxies first. Every session needs one of its own.',
          ),
        ).toBeVisible();
        // A button that opens the form here, not a link that leaves the list.
        expect(
          screen.getByRole('button', { name: 'Add proxies' }),
        ).toBeVisible();
        expect(screen.queryByRole('link', { name: 'Add proxies' })).toBeNull();
        expect(
          screen.queryByRole('button', { name: 'Add session' }),
        ).toBeNull();
      });

      it('opens the form that imports proxies in place, and offers to add the first session once there are some', async () => {
        serve();
        const { user } = renderList();
        await user.click(
          await screen.findByRole('button', { name: 'Add proxies' }),
        );

        const dialog = await screen.findByRole('dialog', {
          name: 'Import proxies',
        });
        await user.click(
          within(dialog).getByRole('textbox', {
            name: 'Proxies, one per line',
          }),
        );
        await user.paste('198.51.100.4:8080\n198.51.100.5:8080');
        await user.click(
          within(dialog).getByRole('button', { name: 'Import proxies' }),
        );

        expect(await screen.findByText('2 proxies added')).toBeVisible();
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        // The list notices on its own, and the focus stays where the person was.
        const add = await screen.findByRole('button', { name: 'Add session' });
        await waitFor(() => expect(add).toBeEnabled());
        expect(add).toHaveFocus();
        expect(
          screen.queryByRole('button', { name: 'Add proxies' }),
        ).toBeNull();
      });

      it('goes back to the button on Cancel, with nothing added', async () => {
        serve();
        const { user } = renderList();
        await user.click(
          await screen.findByRole('button', { name: 'Add proxies' }),
        );
        const dialog = await screen.findByRole('dialog');

        await user.click(
          within(dialog).getByRole('button', { name: 'Cancel' }),
        );

        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        expect(
          screen.getByRole('button', { name: 'Add proxies' }),
        ).toHaveFocus();
      });

      it('has no accessibility violations, with the form open', async () => {
        serve();
        const { user } = renderList();
        await user.click(
          await screen.findByRole('button', { name: 'Add proxies' }),
        );
        await screen.findByRole('dialog');

        await checkAccessibility(document.body);
      });
    });

    it('cannot add while the browser is missing, and says why', async () => {
      installFakeApi({
        'GET /meta': meta({
          browserInstalled: false,
          browserInstalling: true,
          counts: { proxies: 3 },
        }),
        'GET /sessions': list([]),
      });
      const { user } = renderList();

      const add = await screen.findByRole('button', { name: 'Add session' });
      await waitFor(() => expect(add).toHaveAttribute('aria-disabled', 'true'));
      // Focus reaches a disabled button that explains itself.
      await user.tab();
      expect(add).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent(
        'The browser is being installed.',
      );
    });

    it('has no accessibility violations', async () => {
      installFakeApi({
        'GET /meta': meta({ counts: { proxies: 3 } }),
        'GET /sessions': list([]),
      });
      const view = renderList();
      await screen.findByRole('heading', { name: 'No sessions yet' });
      await checkAccessibility(view);
    });
  });

  describe('when the list cannot be loaded', () => {
    it('says what could not be loaded, with a way to try again that recovers', async () => {
      let broken = true;
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () =>
          broken ? failure(500, 'http_500', 'Server error') : list([named(1)]),
      });
      const { user } = renderList();

      const alert = await screen.findByRole('alert');
      // The button beside the message says to try again: the message does not.
      expect(alert).toHaveTextContent("Couldn't load the sessions.");
      expect(alert).not.toHaveTextContent('Something went wrong');
      expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
      await checkAccessibility(
        screen.getByRole('region', { name: 'Session list' }),
      );

      broken = false;
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );

      expect(await screen.findByRole('link', { name: /0001/ })).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('leaves a lost connection to the banner of the page and to Try again', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': failure(0, 'network'),
      });
      renderList();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load the sessions.");
      expect(alert).not.toHaveTextContent("Can't reach");
    });

    it('adds the cause when trying again would not mend it', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': failure(403, 'forbidden_host'),
      });
      renderList();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't load the sessions. Open Session Manager at 127.0.0.1 or localhost.",
      );
    });

    it('marks Try again busy while it runs over rows that stay, and keeps the alert up until it settles', async () => {
      let mode: 'works' | 'broken' | 'slow' = 'works';
      let finish: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => {
          if (mode === 'broken') return failure(500, 'http_500');
          if (mode === 'slow') {
            return new Promise((resolve) => {
              finish = () => resolve(list([named(1)]));
            });
          }
          return list([named(1)]);
        },
      });
      const { user, queryClient } = renderList();
      await screen.findAllByRole('link');
      mode = 'broken';
      await act(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      );
      const alert = await screen.findByRole('alert');
      const retry = within(alert).getByRole('button', { name: 'Try again' });

      mode = 'slow';
      await user.click(retry);

      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getAllByRole('link')).toHaveLength(1);
      finish?.();
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
    });

    it('hands the keyboard on when a retry that worked takes the alert away', async () => {
      let broken = true;
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () =>
          broken ? failure(500, 'http_500') : list([named(1)]),
      });
      const { user, onFocusLost } = renderList();
      const alert = await screen.findByRole('alert');

      broken = false;
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );

      await waitFor(() => expect(onFocusLost).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps the rows already shown and names the failure above them', async () => {
      let broken = false;
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () =>
          broken ? failure(500, 'http_500') : list([named(2), named(1)]),
      });
      const { user, queryClient } = renderList();
      await screen.findAllByRole('link');

      broken = true;
      await act(() =>
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        "Couldn't load the latest sessions. What's listed may be incomplete or out of date.",
      );
      expect(screen.getAllByRole('link')).toHaveLength(2);

      broken = false;
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(screen.getAllByRole('link')).toHaveLength(2);
    });
  });

  describe('as more load while the end scrolls into view', () => {
    const all = Array.from({ length: 120 }, (_, index) => named(120 - index));

    it('loads the next page when the end of the list comes into view', async () => {
      const watcher = stubIntersectionObserver();
      const api = installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': paged(all),
      });
      renderList();

      await screen.findByText('Showing 50 of 120 sessions');
      expect(screen.getAllByRole('link')).toHaveLength(50);
      await waitFor(() => expect(watcher.observing()).toBeGreaterThan(0));

      watcher.reachEnd();

      await screen.findByText('Showing 100 of 120 sessions');
      expect(screen.getAllByRole('link')).toHaveLength(100);
      expect(
        api.callsTo('GET /sessions').map((call) => call.query.get('limit')),
      ).toEqual(['50', '100']);
    });

    it('shows that more are coming, with the rows already there', async () => {
      const watcher = stubIntersectionObserver();
      let release: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': (request) => {
          if (request.query.get('minId') === null) return paged(all)(request);
          return new Promise((resolve) => {
            release = () => resolve(paged(all)(request));
          });
        },
      });
      renderList();
      await screen.findByText('Showing 50 of 120 sessions');
      await waitFor(() => expect(watcher.observing()).toBeGreaterThan(0));

      watcher.reachEnd();

      expect(await screen.findByRole('status')).toHaveTextContent(
        'Loading more…',
      );
      expect(screen.getAllByRole('link')).toHaveLength(50);
      release?.();
      await screen.findByText('Showing 100 of 120 sessions');
      expect(screen.queryByText('Loading more…')).not.toBeInTheDocument();
    });

    it('stops asking once everything is loaded', async () => {
      const watcher = stubIntersectionObserver();
      const api = installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': paged(all.slice(0, 60)),
      });
      renderList();
      await screen.findByText('Showing 50 of 60 sessions');
      await waitFor(() => expect(watcher.observing()).toBeGreaterThan(0));
      watcher.reachEnd();
      await screen.findByText('Showing all 60 sessions');

      expect(watcher.observing()).toBe(0);
      expect(api.callsTo('GET /sessions')).toHaveLength(2);
    });
  });

  describe('the footer', () => {
    afterEach(async () => {
      await resetLanguage();
    });

    it('groups the digits of a count as the language does', async () => {
      const many = Array.from({ length: 1500 }, (_, index) =>
        named(1500 - index),
      );
      installFakeApi({ 'GET /meta': meta(), 'GET /sessions': paged(many) });
      renderList();
      expect(
        await screen.findByText('Showing 50 of 1,500 sessions'),
      ).toBeInTheDocument();
    });

    it('says it in German, with the plural of the language', async () => {
      await showLanguage('de');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(2), named(1)]),
      });
      renderList();
      expect(
        await screen.findByText('Alle 2 Sitzungen werden angezeigt'),
      ).toBeInTheDocument();
    });

    it('says it in French', async () => {
      await showLanguage('fr');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': paged(
          Array.from({ length: 120 }, (_, i) => named(120 - i)),
        ),
      });
      renderList();
      expect(
        await screen.findByText('Affichage de 50 sur 120 sessions'),
      ).toBeInTheDocument();
    });
  });

  describe('keeping the open session in sight', () => {
    const all = Array.from({ length: 120 }, (_, index) => named(120 - index));
    const routes = () => ({
      'GET /meta': meta(),
      'GET /sessions': paged(all),
      'GET /sessions/:id': (request: { params: Record<string, string> }) =>
        all.find((row) => row.id === Number(request.params.id)),
    });

    beforeEach(() => {
      scrollIntoView.mockClear();
      layOutList();
    });

    it('scrolls the list to the open row when it opens, by just what hides it', async () => {
      setOpenPath('/sessions/100');
      installFakeApi(routes());
      renderList();

      await screen.findByRole('link', { name: /0100/ });
      // It is the 21st row: its end is 21 rows down, 408 px below the list.
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBe(21 * ROW_HEIGHT - LIST_HEIGHT),
      );
    });

    it('leaves the list where it is when the open row is in view', async () => {
      setOpenPath('/sessions/115');
      installFakeApi(routes());
      renderList();

      await screen.findByRole('link', { name: /0115/ });
      await screen.findByText('Showing 50 of 120 sessions');
      expect(scrollerOfList().scrollTop).toBe(0);
    });

    // `scrollIntoView` also makes the row the place the Tab key goes on from,
    // even when nothing moved: on a computer the first Tab of the page then
    // landed on the buttons of that row ("Start Weekend trip") and skipped the
    // skip link, the rail and the head of the list. Only the list scrolls.
    it('does not use scrollIntoView, which moves the starting point of the tab key', async () => {
      setOpenPath('/sessions/100');
      installFakeApi(routes());
      renderList();

      await screen.findByRole('link', { name: /0100/ });
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBeGreaterThan(0),
      );
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('keeps the skip link the first stop of the page, whatever row the list brought into view', async () => {
      setOpenPath('/sessions/100');
      installFakeApi(routes());
      const { user } = renderApp(
        <ProxyFlowProvider>
          <SkipLink />
          <main id="main-content" tabIndex={-1}>
            <SessionList onAdd={vi.fn()} onFocusLost={vi.fn()} />
          </main>
        </ProxyFlowProvider>,
      );
      await screen.findByRole('link', { name: /0100/ });
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBeGreaterThan(0),
      );

      await user.tab();

      expect(
        screen.getByRole('link', { name: 'Skip to main content' }),
      ).toHaveFocus();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('does it once, not each time the list is read again', async () => {
      setOpenPath('/sessions/100');
      installFakeApi(routes());
      const { queryClient } = renderList();
      await screen.findByRole('link', { name: /0100/ });
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBeGreaterThan(0),
      );

      // The person scrolls back up to look at something else.
      scrollerOfList().scrollTop = 0;
      await act(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
      );
      await screen.findByText('Showing 50 of 120 sessions');

      expect(scrollerOfList().scrollTop).toBe(0);
    });

    it('shows a session that is older than the rows loaded as a row of its own meanwhile, and reads back until the rows reach it', async () => {
      setOpenPath('/sessions/38');
      let release: (() => void) | undefined;
      const api = installFakeApi({
        ...routes(),
        'GET /sessions': (request) => {
          if (request.query.get('limit') === '50') return paged(all)(request);
          return new Promise((resolve) => {
            release = () => resolve(paged(all)(request));
          });
        },
      });
      renderList();

      // At once: the open session is a row, marked, after the 50 newest.
      const link = await screen.findByRole('link', { name: /0038/ });
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(link).toHaveAttribute('href', '/sessions/38');
      const links = screen.getAllByRole('link');
      expect(links).toHaveLength(51);
      expect(links.at(-1)).toBe(link);
      // It is not scrolled to where it is about to leave.
      await waitFor(() => expect(release).toBeDefined());
      expect(scrollerOfList().scrollTop).toBe(0);

      // The rows are read straight back to it, in one request for the
      // sessions from its id up (not one wider window after another): then it
      // stands where it belongs, once, and is the one scrolled to: 83 rows down.
      release?.();
      await screen.findByText('Showing 83 of 120 sessions');
      expect(screen.getAllByRole('link')).toHaveLength(83);
      expect(screen.getAllByRole('link', { name: /0038/ })).toHaveLength(1);
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBe(83 * ROW_HEIGHT - LIST_HEIGHT),
      );
      expect(
        api
          .callsTo('GET /sessions')
          .map((call) => [call.query.get('limit'), call.query.get('minId')]),
      ).toEqual([
        ['50', null],
        ['120', '38'],
      ]);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('reads the sessions on from the open one when the end of the list is reached afterwards', async () => {
      setOpenPath('/sessions/38');
      const api = installFakeApi(routes());
      const watcher = stubIntersectionObserver();
      renderList();
      await screen.findByText('Showing 83 of 120 sessions');

      watcher.reachEnd();

      await screen.findByText('Showing all 120 sessions');
      expect(screen.getAllByRole('link', { name: /0038/ })).toHaveLength(1);
      const last = api.callsTo('GET /sessions').at(-1);
      expect(last?.query.get('limit')).toBe('133');
      expect(last?.query.get('minId')).toBeNull();
    });

    it('does not read back for a session that is among the rows, or newer than the oldest one', async () => {
      setOpenPath('/sessions/100');
      const api = installFakeApi(routes());
      renderList();
      await screen.findByText('Showing 50 of 120 sessions');

      expect(
        api.callsTo('GET /sessions').map((call) => call.query.get('limit')),
      ).toEqual(['50']);
    });

    it('shows no row twice when the rows loaded include it', async () => {
      setOpenPath('/sessions/100');
      installFakeApi(routes());
      renderList();

      await screen.findByRole('link', { name: /0100/ });
      await screen.findByText('Showing 50 of 120 sessions');
      expect(screen.getAllByRole('link', { name: /0100/ })).toHaveLength(1);
      expect(screen.getAllByRole('link')).toHaveLength(50);
    });

    it('shows no extra row for a session that does not exist', async () => {
      setOpenPath('/sessions/999');
      installFakeApi({
        ...routes(),
        'GET /sessions/:id': failure(404, 'session_not_found'),
      });
      renderList();

      await screen.findByText('Showing 50 of 120 sessions');
      await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(50));
      expect(screen.queryByRole('link', { name: /0999/ })).toBeNull();
    });

    it('has no accessibility violations with the extra row', async () => {
      setOpenPath('/sessions/38');
      installFakeApi(routes());
      const view = renderList();
      await screen.findByRole('link', { name: /0038/ });
      await checkAccessibility(view);
    });
  });

  describe('with the keyboard', () => {
    it('moves from row to row with the arrow keys, Home and End', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(3), named(2), named(1)]),
      });
      const { user } = renderList();
      const links = await screen.findAllByRole('link');

      links[0]?.focus();
      await user.keyboard('{ArrowDown}');
      expect(links[1]).toHaveFocus();
      await user.keyboard('{End}');
      expect(links[2]).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(links[2]).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(links[1]).toHaveFocus();
      await user.keyboard('{Home}');
      expect(links[0]).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(links[0]).toHaveFocus();
    });

    it('keeps the tab order: the link, Start, the menu, then the next row', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(2), named(1)]),
      });
      const { user } = renderList();
      const links = await screen.findAllByRole('link');

      links[0]?.focus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Start 0002' })).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole('button', { name: 'Actions for 0002' }),
      ).toHaveFocus();
      await user.tab();
      expect(links[1]).toHaveFocus();
    });

    it('opens the next session with Alt and Down, and the previous with Alt and Up', async () => {
      setOpenPath('/sessions/2');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(3), named(2), named(1)]),
      });
      const { user } = renderList();
      const links = await screen.findAllByRole('link');
      const opened = vi.fn();
      links.forEach((link, index) =>
        link.addEventListener('click', () => opened(index)),
      );

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
      expect(opened).toHaveBeenLastCalledWith(2);
      await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
      expect(opened).toHaveBeenLastCalledWith(0);
      expect(opened).toHaveBeenCalledTimes(2);
    });

    // The row the keys lead to is brought into view before it is opened, in
    // the list alone: the page keeps the starting point of the tab key.
    it('brings the row it opens into view, by scrolling the list and not the page', async () => {
      const rows = Array.from({ length: 30 }, (_, index) => named(30 - index));
      setOpenPath('/sessions/13');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list(rows),
        'GET /sessions/:id': rows.find((row) => row.id === 13),
      });
      layOutList();
      const { user } = renderList();
      await screen.findByRole('link', { name: /0013/ });
      // The open row is the 18th: scrolled to by the page opening.
      await waitFor(() =>
        expect(scrollerOfList().scrollTop).toBe(18 * ROW_HEIGHT - LIST_HEIGHT),
      );
      scrollIntoView.mockClear();

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

      // The next row (12) is the 19th: its end was one row below the list.
      expect(scrollerOfList().scrollTop).toBe(19 * ROW_HEIGHT - LIST_HEIGHT);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('leaves Alt and the arrows to a text field', async () => {
      setOpenPath('/sessions/2');
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': list([named(3), named(2), named(1)]),
      });
      const { user } = renderApp(
        <ProxyFlowProvider>
          <SessionList onAdd={vi.fn()} onFocusLost={vi.fn()} />
          <input aria-label="Notes" />
        </ProxyFlowProvider>,
      );
      const links = await screen.findAllByRole('link');
      const opened = vi.fn();
      links.forEach((link) => link.addEventListener('click', opened));

      await user.click(screen.getByRole('textbox', { name: 'Notes' }));
      await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

      expect(opened).not.toHaveBeenCalled();
    });
  });

  describe('when a deleted session takes its row', () => {
    it('keeps the keyboard in the list, on the row that took its place', async () => {
      let rows = [named(3), named(2), named(1)];
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => list(rows),
        'GET /secrets': list([]),
        'DELETE /sessions/:id': (request) => {
          rows = rows.filter((row) => row.id !== Number(request.params.id));
          return undefined;
        },
      });
      const { user } = renderList();
      await screen.findAllByRole('link');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 0002' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);

      await waitFor(() =>
        expect(
          screen.queryByRole('link', { name: /0002/ }),
        ).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(screen.getByRole('link', { name: /0001/ })).toHaveFocus(),
      );
    });

    it('moves to the row before it when the last row was the one deleted', async () => {
      let rows = [named(2), named(1)];
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => list(rows),
        'GET /secrets': list([]),
        'DELETE /sessions/:id': (request) => {
          rows = rows.filter((row) => row.id !== Number(request.params.id));
          return undefined;
        },
      });
      const { user } = renderList();
      await screen.findAllByRole('link');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 0001' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);

      await waitFor(() =>
        expect(screen.getByRole('link', { name: /0002/ })).toHaveFocus(),
      );
    });

    it('goes to the page of the sessions when the deleted one was open', async () => {
      setOpenPath('/sessions/2');
      let rows = [named(2), named(1)];
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => list(rows),
        'GET /secrets': list([]),
        'DELETE /sessions/:id': (request) => {
          rows = rows.filter((row) => row.id !== Number(request.params.id));
          return undefined;
        },
      });
      const { user } = renderList();
      await screen.findAllByRole('link');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 0002' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({ to: '/sessions' }),
      );
    });

    it('does not leave a session that was not the open one', async () => {
      setOpenPath('/sessions/1');
      let rows = [named(2), named(1)];
      installFakeApi({
        'GET /meta': meta(),
        'GET /sessions': () => list(rows),
        'GET /secrets': list([]),
        'DELETE /sessions/:id': (request) => {
          rows = rows.filter((row) => row.id !== Number(request.params.id));
          return undefined;
        },
      });
      const { user } = renderList();
      await screen.findAllByRole('link');

      await user.click(
        screen.getByRole('button', { name: 'Actions for 0002' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);

      await waitFor(() =>
        expect(
          screen.queryByRole('link', { name: /0002/ }),
        ).not.toBeInTheDocument(),
      );
      expect(navigate).not.toHaveBeenCalledWith({ to: '/sessions' });
    });
  });
});
