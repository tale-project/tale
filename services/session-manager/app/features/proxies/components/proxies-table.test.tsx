import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POLL_SLOW_MS } from '@/app/lib/polling';
import type { Proxy } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, proxyCheck, sessionRef } from '@/tests/utils/fixtures';

import { addressOf } from '../lib/address';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { proxyPool } from '@/tests/utils/proxies-api';
import { renderInShell } from '@/tests/utils/render';

import { ProxiesTable } from './proxies-table';

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await resetLanguage();
});

/** A proxy whose `display` agrees with its address, as the server's does. */
function member(overrides: Partial<Proxy> & Pick<Proxy, 'id'>): Proxy {
  const row = proxy(overrides);
  return { ...row, display: addressOf(row) };
}

/** One proxy of every kind the table shows, newest first. */
function pool(): Proxy[] {
  return [
    member({ id: 6, host: '198.51.100.6' }),
    member({
      id: 5,
      host: '198.51.100.5',
      check: proxyCheck({ status: 'checking', ok: null }),
    }),
    member({
      id: 4,
      host: '198.51.100.4',
      check: proxyCheck({
        status: 'unchecked',
        ok: null,
        exitIp: null,
        country: null,
        latencyMs: null,
        checkedAt: null,
      }),
    }),
    member({
      id: 3,
      host: '198.51.100.3',
      check: proxyCheck({
        status: 'failed',
        ok: false,
        exitIp: null,
        country: null,
        latencyMs: null,
        error: 'Proxy authentication failed (HTTP 407).',
      }),
    }),
    member({
      id: 2,
      host: '198.51.100.2',
      scheme: 'socks5',
      username: 'ada',
      hasPassword: true,
      check: proxyCheck({
        exitIp: '198.18.5.20',
        country: 'US',
        latencyMs: 1240,
      }),
      session: sessionRef({ id: 8, name: 'shop', status: 'running' }),
    }),
    member({
      id: 1,
      host: '198.51.100.1',
      check: proxyCheck({
        exitIp: '203.0.113.7',
        country: 'FR',
        latencyMs: 98,
      }),
      sameIpAs: sessionRef({ id: 3, name: '0003', status: 'running' }),
    }),
  ];
}

const COUNTS = {
  proxies: 6,
  freeProxies: 3,
  failedProxies: 1,
  checkingProxies: 1,
};

function serve(
  rows: () => Proxy[] = pool,
  counts: Partial<typeof COUNTS> = COUNTS,
) {
  return installFakeApi({
    'GET /proxies': proxyPool(rows),
    'GET /meta': () => meta({ counts }),
  });
}

function rowOf(hostPort: string): HTMLElement {
  const row = screen.getByText(hostPort).closest('tr');
  if (row === null) throw new Error(`no row for ${hostPort}`);
  return row;
}

const searchBox = () => screen.getByRole('textbox', { name: 'Search proxies' });

describe('ProxiesTable', () => {
  describe('the table', () => {
    it('names its columns and the actions of a row', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual([
        'Proxy',
        'Exit IP',
        'Ping',
        'Health',
        'Session',
        'Row actions',
      ]);
      expect(
        screen.getByRole('table', { name: 'Proxies in the pool' }),
      ).toBeVisible();
    });

    it('shows a working proxy nobody has: its exit IP, country, ping and that it is free', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      const row = within(rowOf('198.51.100.6:8080'));
      expect(row.getByText('203.0.113.7')).toBeVisible();
      expect(row.getByText('DE · Germany')).toBeVisible();
      expect(row.getByText('240 ms')).toBeVisible();
      expect(row.getByText('Working')).toBeVisible();
      expect(row.getByText('Free')).toBeVisible();
    });

    it('shows a proxy that is being checked as such', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.5:8080');

      expect(
        within(rowOf('198.51.100.5:8080')).getByText('Checking'),
      ).toBeVisible();
    });

    it('shows a proxy nobody checked with nothing known of it', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.4:8080');

      const row = within(rowOf('198.51.100.4:8080'));
      expect(row.getByText('Not checked')).toBeVisible();
      // The exit IP and the ping: unknown, said so to a screen reader.
      expect(row.getAllByText('Unknown')).toHaveLength(2);
      expect(row.getByText('Free')).toBeVisible();
    });

    it('shows a proxy that does not work with the reason, and as not assigned', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.3:8080');

      const row = within(rowOf('198.51.100.3:8080'));
      expect(row.getByText('Not working')).toBeVisible();
      expect(
        row.getByText('Proxy authentication failed (HTTP 407).'),
      ).toBeVisible();
      expect(row.getByText('Not assigned')).toBeVisible();
      expect(
        row.getByText(
          "A proxy that isn't working is never assigned to a session.",
        ),
      ).toBeVisible();
      expect(row.queryByText('Free')).not.toBeInTheDocument();
    });

    it('shows the session that has a proxy as a link, with its state and the login of the proxy', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.2:8080');

      const row = within(rowOf('198.51.100.2:8080'));
      expect(row.getByText('socks5://ada@')).toBeVisible();
      expect(row.getByText('US · United States')).toBeVisible();
      expect(row.getByText('1,240 ms')).toBeVisible();
      expect(row.getByRole('link', { name: 'shop' })).toHaveAttribute(
        'href',
        '/sessions/8',
      );
      expect(row.getByText('Running')).toBeVisible();
    });

    it('warns of a proxy whose exit IP another session has', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.1:8080');

      const row = within(rowOf('198.51.100.1:8080'));
      expect(row.getByText('Same IP as 0003')).toBeVisible();
      expect(
        row.getByText(
          'Not assigned while the session "0003" has a proxy with the same exit IP.',
        ),
      ).toBeVisible();
    });

    it('ends on the count of the proxies, all of them', async () => {
      serve();
      renderInShell(<ProxiesTable />);

      expect(await screen.findByText('Showing all 6 proxies')).toBeVisible();
    });

    it('counts a single proxy in the singular', async () => {
      serve(() => [proxy({ id: 1 })], { proxies: 1 });
      renderInShell(<ProxiesTable />);

      expect(await screen.findByText('Showing all 1 proxy')).toBeVisible();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual([
        'Proxy',
        'Ausgangs-IP',
        'Ping',
        'Zustand',
        'Sitzung',
        'Aktionen für die Zeile',
      ]);
      expect(screen.getByText('Alle 6 Proxies werden angezeigt')).toBeVisible();
      const row = within(rowOf('198.51.100.1:8080'));
      expect(row.getByText('Dieselbe IP wie 0003')).toBeVisible();
      expect(row.getByText('FR · Frankreich')).toBeVisible();
    });
  });

  describe('the summary', () => {
    it('counts the proxies, the free ones and the ones that do not work', async () => {
      serve();
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByText('6 proxies · 3 free · 1 not working'),
      ).toBeVisible();
    });

    it('leaves out what is not the case', async () => {
      serve(pool, { proxies: 1, freeProxies: 1, failedProxies: 0 });
      renderInShell(<ProxiesTable />);

      expect(await screen.findByText('1 proxy · 1 free')).toBeVisible();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      serve(pool, { proxies: 6, freeProxies: 3, failedProxies: 2 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByText('6 Proxies · 3 frei · 2 funktionieren nicht'),
      ).toBeVisible();
    });

    it('groups the digits of a big pool, every number the same way', async () => {
      serve(pool, { proxies: 1500, freeProxies: 1200, failedProxies: 1234 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByText(
          '1,500 proxies · 1,200 free · 1,234 not working',
        ),
      ).toBeVisible();
    });

    it('groups them as German does', async () => {
      await showLanguage('de');
      serve(pool, { proxies: 1500, freeProxies: 1200, failedProxies: 1234 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByText(
          '1.500 Proxies · 1.200 frei · 1.234 funktionieren nicht',
        ),
      ).toBeVisible();
    });

    it('speaks French, in the singular where there is one', async () => {
      await showLanguage('fr');
      serve(pool, { proxies: 1, freeProxies: 0, failedProxies: 1 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByText('1 proxy · 0 libre · 1 ne fonctionne pas'),
      ).toBeVisible();
    });

    it('is not there without proxies', async () => {
      serve(() => [], { proxies: 0, freeProxies: 0, failedProxies: 0 });
      renderInShell(<ProxiesTable />);
      await screen.findByText('No proxies yet');

      expect(screen.queryByText(/ free/)).not.toBeInTheDocument();
    });
  });

  describe('the toolbar', () => {
    const region = (name = 'Proxy list') =>
      screen.getByRole('region', { name });

    it('has the way to check every proxy beside the way to add one, the check first', async () => {
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      const check = within(region()).getByRole('button', {
        name: 'Check all proxies',
      });
      const add = within(region()).getByRole('button', { name: 'Add proxy' });
      // Secondary before primary, side by side, after the search.
      expect(
        check.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        searchBox().compareDocumentPosition(check) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('checks every proxy from there', async () => {
      const api = serve();
      api.on('POST /proxies/check-all', () => pool());
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');
      const check = within(region()).getByRole('button', {
        name: 'Check all proxies',
      });
      await waitFor(() => expect(check).toBeEnabled());

      await user.click(check);

      await waitFor(() =>
        expect(api.callsTo('POST /proxies/check-all')).toHaveLength(1),
      );
    });

    it('still has the add menu with its two ways', async () => {
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      await user.click(
        within(region()).getByRole('button', { name: 'Add proxy' }),
      );

      expect(
        (await screen.findAllByRole('menuitem')).map(
          (item) => item.textContent,
        ),
      ).toEqual(['Manual entry', 'Import a list']);
    });

    it('has nothing to check without proxies, so it is not there: the empty state has the one way to add', async () => {
      serve(() => [], { proxies: 0 });
      renderInShell(<ProxiesTable />);
      await screen.findByRole('heading', { name: 'No proxies yet' });

      expect(
        screen.queryByRole('button', { name: 'Check all proxies' }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Add proxy' })).toHaveLength(
        1,
      );
    });

    it('is not there either while the first read fails', async () => {
      installFakeApi({
        'GET /proxies': failure(500, 'internal', 'Boom'),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      renderInShell(<ProxiesTable />);
      await screen.findByRole('button', { name: 'Try again' });

      expect(
        screen.queryByRole('button', { name: 'Check all proxies' }),
      ).not.toBeInTheDocument();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      expect(
        within(region('Proxy-Liste')).getByRole('button', {
          name: 'Alle Proxies prüfen',
        }),
      ).toBeVisible();
      expect(
        within(region('Proxy-Liste')).getByRole('button', {
          name: 'Proxy hinzufügen',
        }),
      ).toBeVisible();
    });
  });

  describe('searching', () => {
    it.each([
      ['its address', '198.51.100.2', ['198.51.100.2:8080']],
      ['the login of the proxy', 'ada', ['198.51.100.2:8080']],
      [
        'its exit IP',
        '203.0.113.7',
        ['198.51.100.6:8080', '198.51.100.5:8080', '198.51.100.1:8080'],
      ],
      ['its country code', 'us', ['198.51.100.2:8080']],
      ['its country', 'germany', ['198.51.100.6:8080', '198.51.100.5:8080']],
      ['the session that has it', 'shop', ['198.51.100.2:8080']],
      ['the session of its exit IP', '0003', ['198.51.100.1:8080']],
    ])('finds a proxy by %s', async (_how, query, found) => {
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      await user.click(searchBox());
      await user.type(searchBox(), query);

      await waitFor(() =>
        expect(
          screen
            .getAllByRole('row')
            .slice(1)
            .map(
              (row) => /198\.51\.100\.\d:8080/.exec(row.textContent ?? '')?.[0],
            ),
        ).toEqual(found),
      );
      expect(
        screen.getByText(`Showing ${found.length} of 6 proxies`),
      ).toBeVisible();
    });

    // What a person reads in the table is what they can type: the words of
    // the health, of the session column and of a session's state.
    it.each([
      ['the health "Not working"', 'not working', ['198.51.100.3:8080']],
      ['the health "Checking"', 'checking', ['198.51.100.5:8080']],
      ['the health "Not checked"', 'not checked', ['198.51.100.4:8080']],
      [
        'the word "Free"',
        'free',
        ['198.51.100.6:8080', '198.51.100.5:8080', '198.51.100.4:8080'],
      ],
      [
        'the words "Not assigned"',
        'not assigned',
        ['198.51.100.3:8080', '198.51.100.1:8080'],
      ],
      ['the state of its session', 'running', ['198.51.100.2:8080']],
      [
        'the words of the flag a shared exit IP has',
        'same ip',
        ['198.51.100.1:8080'],
      ],
      [
        'the reason a check failed',
        'authentication failed',
        ['198.51.100.3:8080'],
      ],
    ])('finds a proxy by %s', async (_how, query, found) => {
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      await user.click(searchBox());
      await user.type(searchBox(), query);

      await waitFor(() =>
        expect(
          screen
            .getAllByRole('row')
            .slice(1)
            .map(
              (row) => /198\.51\.100\.\d:8080/.exec(row.textContent ?? '')?.[0],
            ),
        ).toEqual(found),
      );
    });

    it('finds the proxies the words of the language say, as the table says them', async () => {
      await showLanguage('de');
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      const german = screen.getByRole('textbox', { name: 'Proxies suchen' });
      await user.click(german);
      await user.type(german, 'funktioniert nicht');

      await waitFor(() =>
        expect(screen.getByText('198.51.100.3:8080')).toBeVisible(),
      );
      expect(screen.queryByText('198.51.100.6:8080')).not.toBeInTheDocument();
      expect(
        screen.getByText('1 von 6 Proxies werden angezeigt'),
      ).toBeVisible();
    });

    it('says so when nothing matches, and the query can be cleared', async () => {
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      await user.click(searchBox());
      await user.type(searchBox(), 'nothing like it');

      expect(await screen.findByText('No results found')).toBeVisible();
      expect(screen.queryByText('198.51.100.6:8080')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Clear search' }));

      expect(await screen.findByText('198.51.100.6:8080')).toBeVisible();
      expect(searchBox()).toHaveValue('');
    });

    it('offers to clear the search only while there is one, in words that cannot be read as deleting', async () => {
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');
      expect(
        screen.queryByRole('button', { name: 'Clear search' }),
      ).not.toBeInTheDocument();

      await user.click(searchBox());
      await user.type(searchBox(), '198.51');
      expect(
        screen.getByRole('button', { name: 'Clear search' }),
      ).toBeVisible();
      // Not the library's "Clear all", which the German says as "Alle löschen".
      expect(
        screen.queryByRole('button', { name: 'Clear all' }),
      ).not.toBeInTheDocument();
    });

    it('says it in German as the proxies are not deleted', async () => {
      await showLanguage('de');
      serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      const german = screen.getByRole('textbox', { name: 'Proxies suchen' });
      await user.click(german);
      await user.type(german, '198.51');

      expect(
        screen.getByRole('button', { name: 'Suche zurücksetzen' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Alle löschen' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('while the proxies load', () => {
    it('masks the rows in place, the toolbar already there', async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      installFakeApi({
        'GET /proxies': async (request) => {
          await gate;
          return proxyPool(pool)(request);
        },
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByRole('status', { name: 'Loading content' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add proxy' })).toBeVisible();
      expect(
        screen.queryByText('Showing all 6 proxies'),
      ).not.toBeInTheDocument();

      release();
      expect(await screen.findByText('Showing all 6 proxies')).toBeVisible();
      expect(
        screen.queryByRole('status', { name: 'Loading content' }),
      ).not.toBeInTheDocument();
    });

    it('says there are none at once when the counts say so: no toolbar and no masked rows that vanish when the rows come', async () => {
      installFakeApi({
        // The first rows never come: the counts alone decide.
        'GET /proxies': () => new Promise<never>(() => {}),
        'GET /meta': () => meta({ counts: { proxies: 0 } }),
      });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByRole('heading', { name: 'No proxies yet' }),
      ).toBeVisible();
      expect(
        screen.queryByRole('status', { name: 'Loading content' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Search proxies' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Check all proxies' }),
      ).not.toBeInTheDocument();
      // The way to add is the empty state's.
      expect(screen.getAllByRole('button', { name: 'Add proxy' })).toHaveLength(
        1,
      );
    });
  });

  describe('without proxies', () => {
    it('says what proxies are for, and offers to add or import them', async () => {
      serve(() => [], { proxies: 0 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByRole('heading', { name: 'No proxies yet' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'Add proxies so every session can have one of its own.',
        ),
      ).toBeVisible();
      // The create action is the table's, in the empty state while there are
      // no proxies: one button, which names what it adds.
      expect(screen.getAllByRole('button', { name: 'Add proxy' })).toHaveLength(
        1,
      );
      // Nothing to search, or to count: no toolbar to say so.
      expect(
        screen.queryByRole('textbox', { name: 'Search proxies' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    });

    it('offers the two ways to add proxies from the empty state, as the toolbar does', async () => {
      serve(() => [], { proxies: 0 });
      const { user } = renderInShell(<ProxiesTable />);

      await screen.findByRole('heading', { name: 'No proxies yet' });
      await user.click(screen.getByRole('button', { name: 'Add proxy' }));
      expect(
        (await screen.findAllByRole('menuitem')).map(
          (item) => item.textContent,
        ),
      ).toEqual(['Manual entry', 'Import a list']);
    });

    it('opens the dialogs from the empty state', async () => {
      serve(() => [], { proxies: 0 });
      const { user } = renderInShell(<ProxiesTable />);

      await screen.findByRole('heading', { name: 'No proxies yet' });
      await user.click(screen.getByRole('button', { name: 'Add proxy' }));
      await user.click(
        await screen.findByRole('menuitem', { name: 'Manual entry' }),
      );
      expect(
        await screen.findByRole('dialog', { name: 'Add proxy' }),
      ).toBeVisible();
      await user.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );

      await user.click(screen.getByRole('button', { name: 'Add proxy' }));
      await user.click(
        await screen.findByRole('menuitem', { name: 'Import a list' }),
      );
      expect(
        await screen.findByRole('dialog', { name: 'Import proxies' }),
      ).toBeVisible();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      serve(() => [], { proxies: 0 });
      renderInShell(<ProxiesTable />);

      expect(
        await screen.findByRole('heading', { name: 'Noch keine Proxies' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'Füge Proxies hinzu, damit jede Sitzung einen eigenen bekommt.',
        ),
      ).toBeVisible();
    });
  });

  describe('when the proxies cannot be loaded', () => {
    it('says so with a way to try again, and shows the proxies once it works', async () => {
      const api = installFakeApi({
        'GET /proxies': failure(500, 'internal', 'Boom'),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      const { user } = renderInShell(<ProxiesTable />);

      // The words of this page, as the sessions have them, not the library's
      // "Something went wrong" with a link to a support page of its own.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent("Couldn't load the proxies.");
      expect(alert).not.toHaveTextContent('incomplete or out of date');
      expect(
        screen.queryByText(/Something went wrong/),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(
        screen.queryByText('Showing all 6 proxies'),
      ).not.toBeInTheDocument();
      // A list that could not be read is not an empty one.
      expect(
        screen.queryByRole('heading', { name: 'No proxies yet' }),
      ).not.toBeInTheDocument();

      api.on('GET /proxies', proxyPool(pool));
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );

      expect(await screen.findByText('198.51.100.6:8080')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
      // The retry held the focus and went with the alert: the list takes it.
      await waitFor(() =>
        expect(
          screen.getByRole('region', { name: 'Proxy list' }),
        ).toHaveFocus(),
      );
    });

    it('adds the cause to the first failure too, when trying again does not mend it', async () => {
      installFakeApi({
        'GET /proxies': failure(403, 'forbidden_host', 'x'),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      renderInShell(<ProxiesTable />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't load the proxies. Open Session Manager at 127.0.0.1 or localhost.",
      );
    });

    it('says it in German when the first read fails', async () => {
      await showLanguage('de');
      installFakeApi({
        'GET /proxies': failure(500, 'internal', 'Boom'),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      renderInShell(<ProxiesTable />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Die Proxies konnten nicht geladen werden.',
      );
      expect(
        screen.getByRole('button', { name: 'Erneut versuchen' }),
      ).toBeVisible();
    });

    it('keeps the proxies on screen through a failed refresh, and says what that means for them', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = serve();
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      api.on('GET /proxies', failure(500, 'network', 'Cannot reach'));
      await act(() => vi.advanceTimersByTimeAsync(POLL_SLOW_MS));

      // The sentence is about the list: the page's banner says why it failed.
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        "Couldn't load the latest proxies. What's listed may be incomplete or out of date.",
      );
      expect(alert).not.toHaveTextContent("Can't reach Session Manager");
      expect(screen.getByText('198.51.100.6:8080')).toBeVisible();

      api.on('GET /proxies', proxyPool(pool));
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
      expect(screen.getByText('198.51.100.6:8080')).toBeVisible();
      // The retry held the focus and went with the alert: the list takes it.
      await waitFor(() =>
        expect(
          screen.getByRole('region', { name: 'Proxy list' }),
        ).toHaveFocus(),
      );
    });

    it('says only what it means for the list when the failure only says to try again, and never the backend sentence', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      api.on('GET /proxies', failure(500, 'boom', 'Something exploded'));
      await act(() => vi.advanceTimersByTimeAsync(POLL_SLOW_MS));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        "Couldn't load the latest proxies. What's listed may be incomplete or out of date.",
      );
      expect(alert).not.toHaveTextContent('Something went wrong');
      expect(screen.queryByText(/Something exploded/)).not.toBeInTheDocument();
    });

    it('adds the cause when trying again does not mend it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      api.on('GET /proxies', failure(403, 'forbidden_host', 'x'));
      await act(() => vi.advanceTimersByTimeAsync(POLL_SLOW_MS));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't load the latest proxies. What's listed may be incomplete or out of date. Open Session Manager at 127.0.0.1 or localhost.",
      );
    });

    it('says it in German', async () => {
      await showLanguage('de');
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = serve();
      renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');

      api.on('GET /proxies', failure(500, 'network', 'Cannot reach'));
      await act(() => vi.advanceTimersByTimeAsync(POLL_SLOW_MS));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Die neuesten Proxies konnten nicht geladen werden. Die Liste ist womöglich unvollständig oder veraltet.',
      );
    });
  });

  describe('reading further down', () => {
    /** The observers the table watches its end with, to say "now it is in view". */
    class RecordingObserver {
      static all: RecordingObserver[] = [];
      readonly root = null;
      readonly rootMargin = '';
      readonly scrollMargin = '';
      readonly thresholds = [];
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
      constructor(readonly callback: IntersectionObserverCallback) {
        RecordingObserver.all.push(this);
      }
    }

    /**
     * The end of the table comes into view: the element the table asked to be
     * told about has crossed into the viewport. Says whether anything watches.
     */
    function reachTheEnd(): boolean {
      const watching = RecordingObserver.all.filter(
        (observer) => observer.disconnect.mock.calls.length === 0,
      );
      const observer = watching.at(-1);
      const target = observer?.observe.mock.calls.at(-1)?.[0];
      if (observer === undefined || !(target instanceof Element)) return false;
      act(() => {
        observer.callback(
          [
            {
              isIntersecting: true,
              intersectionRatio: 1,
              target,
              time: 0,
              boundingClientRect: new DOMRect(),
              intersectionRect: new DOMRect(),
              rootBounds: null,
            },
          ],
          observer,
        );
      });
      return true;
    }

    const many = (size: number) =>
      Array.from({ length: size }, (_unused, index) =>
        member({
          id: index + 1,
          host: `10.0.${Math.floor(index / 250)}.${(index % 250) + 1}`,
        }),
      );

    it('shows the newest first, and loads more as the end comes into view', async () => {
      RecordingObserver.all = [];
      vi.stubGlobal('IntersectionObserver', RecordingObserver);
      const rows = many(130);
      const api = serve(() => rows, { proxies: 130, freeProxies: 130 });
      renderInShell(<ProxiesTable />);

      // The first window: the newest twenty of the sixty asked for, counted
      // against the 130 of the pool and not against the sixty.
      expect(
        await screen.findByText('Showing 20 of 130 proxies'),
      ).toBeVisible();
      expect(screen.getByText('10.0.0.130:8080')).toBeVisible();
      expect(screen.queryByText('10.0.0.110:8080')).not.toBeInTheDocument();
      expect(api.callsTo('GET /proxies')[0]?.query.get('limit')).toBe('60');

      // The end comes into view: twenty more, and a wider window ahead.
      expect(reachTheEnd()).toBe(true);
      expect(await screen.findByText('10.0.0.110:8080')).toBeVisible();
      await waitFor(() =>
        expect(
          api.callsTo('GET /proxies').map((call) => call.query.get('limit')),
        ).toContain('120'),
      );
    });

    it('ends on all of them once the whole pool is read', async () => {
      RecordingObserver.all = [];
      vi.stubGlobal('IntersectionObserver', RecordingObserver);
      const rows = many(50);
      serve(() => rows, { proxies: 50, freeProxies: 50 });
      renderInShell(<ProxiesTable />);
      await screen.findByText('Showing 20 of 50 proxies');

      for (let step = 0; step < 3; step += 1) {
        if (!reachTheEnd()) break;
        await act(() => Promise.resolve());
      }

      expect(await screen.findByText('Showing all 50 proxies')).toBeVisible();
    });

    it('searches the proxies not shown yet, reading the whole pool for it', async () => {
      const rows = many(130);
      const api = serve(() => rows, { proxies: 130, freeProxies: 130 });
      const { user } = renderInShell(<ProxiesTable />);
      await screen.findByText('Showing 20 of 130 proxies');

      await user.click(searchBox());
      await user.type(searchBox(), '10.0.0.3:');

      await waitFor(() =>
        expect(
          api
            .callsTo('GET /proxies')
            .map((call) => Number(call.query.get('limit'))),
        ).toContain(240),
      );
      expect(await screen.findByText('10.0.0.3:8080')).toBeVisible();
    });
  });

  describe('accessibility', () => {
    it('has no violations with proxies of every kind', async () => {
      serve();
      const view = renderInShell(<ProxiesTable />);
      await screen.findByText('Showing all 6 proxies');

      await checkAccessibility(view);
    });

    it('has no violations while loading', async () => {
      installFakeApi({
        'GET /proxies': () => new Promise<never>(() => {}),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      const view = renderInShell(<ProxiesTable />);
      await screen.findByRole('status', { name: 'Loading content' });

      await checkAccessibility(view);
    });

    it('has no violations without proxies', async () => {
      serve(() => [], { proxies: 0 });
      const view = renderInShell(<ProxiesTable />);
      await screen.findByText('No proxies yet');

      await checkAccessibility(view);
    });

    it('has no violations when nothing matches', async () => {
      serve();
      const { user, ...view } = renderInShell(<ProxiesTable />);
      await screen.findByText('198.51.100.6:8080');
      await user.click(searchBox());
      await user.type(searchBox(), 'zzz');
      await screen.findByText('No results found');

      await checkAccessibility(view);
    });

    it('has no violations when the proxies cannot be loaded', async () => {
      installFakeApi({
        'GET /proxies': failure(500, 'internal', 'Boom'),
        'GET /meta': () => meta({ counts: COUNTS }),
      });
      const view = renderInShell(<ProxiesTable />);
      await screen.findByRole('button', { name: 'Try again' });

      await checkAccessibility(view);
    });
  });
});
