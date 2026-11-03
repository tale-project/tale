import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Proxy } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, proxyCheck, sessionRef } from '@/tests/utils/fixtures';
import { stubWidth } from '@/tests/utils/width';

import { addressOf } from '../lib/address';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { proxyPool } from '@/tests/utils/proxies-api';
import { renderInShell } from '@/tests/utils/render';

import { PROXIES_TABLE_MIN_WIDTH } from '../hooks/use-proxies-columns';
import { ProxiesTable } from './proxies-table';

let width: ReturnType<typeof stubWidth> | undefined;

afterEach(async () => {
  width?.restore();
  width = undefined;
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

function serve(rows: () => Proxy[] = pool) {
  return installFakeApi({
    'GET /proxies': proxyPool(rows),
    'GET /meta': () => meta({ counts: COUNTS }),
    'POST /proxies/:id/check': ({ params }) =>
      rows().find((row) => row.id === Number(params.id)),
  });
}

/** The column the table lives in is this wide: the table is the page's region. */
function columnIs(pixels: number, region = 'Proxy list') {
  width = stubWidth(
    (element) => element.getAttribute('aria-label') === region,
    pixels,
  );
  return width;
}

const headers = () =>
  screen.getAllByRole('columnheader').map((header) => header.textContent);

function rowOf(hostPort: string): HTMLElement {
  const row = screen.getByText(hostPort).closest('tr');
  if (row === null) throw new Error(`no row for ${hostPort}`);
  return row;
}

describe('the proxies in a column that has room for their columns', () => {
  it('are a table with a column for each thing a proxy says, and a menu at the end of the row', async () => {
    columnIs(PROXIES_TABLE_MIN_WIDTH);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    expect(headers()).toEqual([
      'Proxy',
      'Exit IP',
      'Ping',
      'Health',
      'Session',
      'Row actions',
    ]);
  });
});

describe('the proxies in a column too narrow for their columns', () => {
  it('are one row each, instead of columns that scroll away, as soon as the column is a pixel short', async () => {
    const stub = columnIs(PROXIES_TABLE_MIN_WIDTH);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');
    expect(headers()).toHaveLength(6);

    stub.resize(PROXIES_TABLE_MIN_WIDTH - 1);
    await waitFor(() => expect(headers()).toEqual(['Proxy', 'Row actions']));

    stub.resize(PROXIES_TABLE_MIN_WIDTH);
    await waitFor(() => expect(headers()).toHaveLength(6));
  });

  it('say, in the row of a working proxy, its address, where it exits and how fast, that it works and that nobody has it', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    const row = within(rowOf('198.51.100.6:8080'));
    expect(row.getByText('203.0.113.7')).toBeVisible();
    expect(row.getByText('DE · Germany')).toBeVisible();
    expect(row.getByText('240 ms')).toBeVisible();
    expect(row.getByText('Working')).toBeVisible();
    expect(row.getByText(/^Checked /)).toBeVisible();
    expect(row.getByText('Free')).toBeVisible();
  });

  it('name each part for a screen reader, since a row of this kind has no column headers over it', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    const row = within(rowOf('198.51.100.6:8080'));
    expect(row.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Exit IP',
      'Health',
      'Session',
    ]);
    expect(row.getAllByRole('definition')).toHaveLength(3);
  });

  it('name the ping too, so a screen reader does not hear a bare figure after the country', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    const row = within(rowOf('198.51.100.6:8080'));
    expect(row.getByText('240 ms')).toHaveTextContent('Ping 240 ms');
    // The country, which the ping is not part of.
    expect(row.getByText('DE · Germany')).not.toHaveTextContent('Ping');
  });

  it('say why a proxy does not work, in full, and that no session has it', async () => {
    columnIs(356);
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
    // Nothing to say of an exit that was never reached.
    expect(
      row.queryByRole('term', { name: 'Exit IP' }),
    ).not.toBeInTheDocument();
  });

  it('say that a proxy is being checked, and that one nobody checked is not', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.5:8080');

    expect(
      within(rowOf('198.51.100.5:8080')).getByText('Checking'),
    ).toBeVisible();
    const unchecked = within(rowOf('198.51.100.4:8080'));
    expect(unchecked.getByText('Not checked')).toBeVisible();
    expect(
      unchecked.queryByRole('term', { name: 'Exit IP' }),
    ).not.toBeInTheDocument();
  });

  it('link to the session that has the proxy, with its state, and warn of a proxy whose exit IP another session has', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.2:8080');

    const taken = within(rowOf('198.51.100.2:8080'));
    expect(taken.getByRole('link', { name: 'shop' })).toHaveAttribute(
      'href',
      '/sessions/8',
    );
    expect(taken.getByText('Running')).toBeVisible();
    expect(taken.getByText('198.18.5.20')).toBeVisible();
    expect(taken.getByText('US · United States')).toBeVisible();
    expect(taken.getByText('1,240 ms')).toBeVisible();

    const shared = within(rowOf('198.51.100.1:8080'));
    expect(shared.getByText('Same IP as 0003')).toBeVisible();
    expect(
      shared.getByText(
        'Not assigned while the session "0003" has a proxy with the same exit IP.',
      ),
    ).toBeVisible();
  });

  it('keep the menu of the row, which checks the proxy again', async () => {
    columnIs(356);
    const api = serve();
    const { user } = renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    await user.click(
      screen.getByRole('button', { name: 'Actions for 198.51.100.6:8080' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Check' }));

    await waitFor(() =>
      expect(api.callsTo('POST /proxies/:id/check')).toHaveLength(1),
    );
  });

  it('keep the search, the summary, the way to check every proxy and the way to add proxies', async () => {
    columnIs(356);
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    expect(
      screen.getByRole('textbox', { name: 'Search proxies' }),
    ).toBeVisible();
    expect(
      screen.getByText('6 proxies · 3 free · 1 not working'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add proxy' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Check all proxies' }),
    ).toBeVisible();
  });

  it('can be searched as the table can', async () => {
    columnIs(356);
    serve();
    const { user } = renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.6:8080');

    await user.click(screen.getByRole('textbox', { name: 'Search proxies' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Search proxies' }),
      'shop',
    );

    await waitFor(() =>
      expect(screen.queryByText('198.51.100.6:8080')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('198.51.100.2:8080')).toBeVisible();
  });

  it('read in German', async () => {
    await showLanguage('de');
    columnIs(356, 'Proxy-Liste');
    serve();
    renderInShell(<ProxiesTable />);
    await screen.findByText('198.51.100.1:8080');

    expect(headers()).toEqual(['Proxy', 'Aktionen für die Zeile']);
    const row = within(rowOf('198.51.100.1:8080'));
    expect(row.getByText('FR · Frankreich')).toBeVisible();
    expect(row.getByText('98 ms')).toBeVisible();
    expect(row.getByText('Funktioniert')).toBeVisible();
    expect(row.getByText('Dieselbe IP wie 0003')).toBeVisible();
    expect(row.getAllByRole('term').map((term) => term.textContent)).toEqual([
      'Ausgangs-IP',
      'Zustand',
      'Sitzung',
    ]);
  });

  it('have no accessibility violations, with a proxy of every kind', async () => {
    columnIs(356);
    serve();
    const view = renderInShell(<ProxiesTable />);
    await screen.findByText('Showing all 6 proxies');
    await checkAccessibility(view);
  });

  it('have no accessibility violations while they load', async () => {
    columnIs(356);
    installFakeApi({
      'GET /proxies': () => new Promise<never>(() => {}),
      'GET /meta': () => meta({ counts: COUNTS }),
    });
    const view = renderInShell(<ProxiesTable />);
    await screen.findByRole('status', { name: 'Loading content' });
    await checkAccessibility(view);
  });
});
