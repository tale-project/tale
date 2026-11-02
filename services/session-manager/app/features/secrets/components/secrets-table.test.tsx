import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure } from '@/tests/utils/fake-api';
import { secret } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';
import {
  allSecrets,
  installSecretsApi,
  SAMPLE,
  summaryOf,
} from '@/tests/utils/secrets-api';
import {
  chipOf,
  chooseFilter,
  closeFilterPanel,
  filterButton,
  filterPanel,
  HeldSecretsTable,
  openFilterPanel,
  optionsOf,
} from '@/tests/utils/secrets-held-table';
import { ToastProbe } from '@/tests/utils/toast-probe';
import { stubWidth } from '@/tests/utils/width';

import { SECRET_LISTS } from '../hooks/use-secrets';
import { SECRETS_TABLE_MIN_WIDTH } from '../hooks/use-secrets-columns';
import type { SecretsFilters } from '../lib/filters';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/secrets');
});

let width: ReturnType<typeof stubWidth> | undefined;

beforeEach(() => {
  // Ages are read against this moment; only the date is faked, so waiting works.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  width?.restore();
  width = undefined;
  localStorage.clear();
  await i18n.changeLanguage('en');
});

/** Every value a secret hides: none of them may be anywhere on the page. */
const HIDDEN_VALUES = [
  'correct horse battery staple',
  'swordfish',
  'hunter2',
  '8814-2290-6613',
  '4242 4242 4242 4242',
];

async function renderTable(
  options: Parameters<typeof installSecretsApi>[0] = {},
  initial?: SecretsFilters,
  onChange?: (filters: SecretsFilters) => void,
) {
  const backend = installSecretsApi(options);
  const view = renderApp(
    <>
      <HeldSecretsTable initial={initial} onChange={onChange} />
      <ToastProbe />
    </>,
  );
  // The list has been read, whatever it holds (rows, nothing, or a failure).
  await waitFor(() =>
    expect(screen.queryByRole('status', { busy: true })).toBeNull(),
  );
  return { ...view, ...backend };
}

/** The list as the fake server holds it, for a route a test put back. */
function installedList() {
  return allSecrets().map(summaryOf);
}

/** The row of the secret with this title. */
function rowOf(title: string): HTMLElement {
  const row = screen.getByRole('button', { name: title }).closest('tr');
  if (row === null) throw new Error(`No row for ${title}`);
  return row;
}

/** The title of each row, in order: the first control of the row. */
function titles(): string[] {
  const table = screen.getByRole('table', { name: 'Secrets' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0]?.textContent ?? '');
}

const search = () => screen.getByRole('textbox', { name: 'Search secrets' });

/** The width the table gives the column with this header, as it declares it. */
function widthOf(header: string): string {
  const cell = within(screen.getByRole('table', { name: 'Secrets' }))
    .getAllByRole('columnheader')
    .find((candidate) => candidate.textContent === header);
  if (!(cell instanceof HTMLElement)) throw new Error(`no ${header} column`);
  return cell.style.width;
}

/** The column the table lives in is this wide: the table is the page's region. */
function columnIs(pixels: number) {
  width = stubWidth(
    (element) =>
      element.getAttribute('role') === 'region' &&
      element.getAttribute('aria-label') === 'Secrets',
    pixels,
  );
  return width;
}

describe('the list of secrets', () => {
  it('is a table named Secrets, with the columns of a secret', async () => {
    await renderTable();
    const table = screen.getByRole('table', { name: 'Secrets' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Title',
      'Type',
      'Available to',
      'Details',
      'Updated',
      'Row actions',
    ]);
  });

  it('lists every secret, newest first, and counts them', async () => {
    await renderTable();
    expect(titles()).toEqual([
      'Wi-Fi at the office',
      'Visa ending 4242',
      'Example shop',
      'My details',
      'Bank',
      'Mail',
    ]);
    expect(screen.getByText('Showing all 6 secrets')).toBeInTheDocument();
  });

  it('reads one row: its title, its type, who it is for, its details and its age', async () => {
    await renderTable();
    const row = rowOf('Example shop');
    const cells = within(row);
    expect(cells.getByText('Credentials')).toBeInTheDocument();
    expect(cells.getByText('Every session')).toBeInTheDocument();
    expect(
      cells.getByText('https://shop.example.com · ada@example.com'),
    ).toBeInTheDocument();
    expect(cells.getByText('4 hours ago')).toBeInTheDocument();
  });

  it('names the type of each kind in the language of the person', async () => {
    await renderTable();
    const table = screen.getByRole('table', { name: 'Secrets' });
    for (const label of [
      'Note',
      'Credit card',
      'Credentials',
      'Personal information',
    ]) {
      expect(within(table).getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('names the session of a secret for one, as a link to the session', async () => {
    await renderTable();
    const row = rowOf('Visa ending 4242');
    const link = within(row).getByRole('link', { name: '0003' });
    expect(link).toHaveAttribute('href', '/sessions/3');

    const bank = rowOf('Bank');
    expect(within(bank).getByRole('link', { name: 'Shop EU' })).toHaveAttribute(
      'href',
      '/sessions/12',
    );
  });

  it('shows no link for a secret for every session', async () => {
    await renderTable({ secrets: [SAMPLE.credentials] });
    const row = rowOf('Example shop');
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a dash, named for a screen reader, for a secret with no details', async () => {
    const bare = secret({
      id: 40,
      title: 'Only a password',
      preview: '',
      fields: [],
    });
    await renderTable({ secrets: [bare] });
    await screen.findByRole('button', { name: 'Only a password' });
    const row = rowOf('Only a password');
    expect(within(row).getByText('No details')).toBeInTheDocument();
  });

  it('shows a very long title cut short, with the whole title where it is read on hover', async () => {
    const long = 'A'.repeat(200);
    await renderTable({ secrets: [secret({ id: 41, title: long })] });
    const button = await screen.findByRole('button', { name: long });
    expect(button).toHaveAttribute('title', long);
  });

  it('never shows a hidden value: the page only has what the list endpoint sends', async () => {
    const { api } = await renderTable();
    for (const value of HIDDEN_VALUES) {
      expect(document.body.textContent).not.toContain(value);
    }
    // The list is read once; no secret was fetched whole.
    expect(api.callsTo('GET /secrets')).toHaveLength(1);
    expect(api.callsTo('GET /secrets/:id')).toHaveLength(0);
    const sent = JSON.stringify(allSecrets().map(summaryOf));
    for (const value of HIDDEN_VALUES) expect(sent).not.toContain(value);
  });

  it('shows the card number only as its last four digits, as the server previews it', async () => {
    await renderTable();
    expect(
      screen.getByText('•••• 4242 · Ada Lovelace · 08/29'),
    ).toBeInTheDocument();
  });
});

describe('the filters of the list', () => {
  it('are one Filter button beside the search, not a control of their own for each', async () => {
    await renderTable();

    expect(filterButton()).toBeInTheDocument();
    expect(
      search().compareDocumentPosition(filterButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Available to/ }),
    ).not.toBeInTheDocument();
  });

  it('open in a panel with a group for the type and one for who the secrets are available to', async () => {
    const { user } = await renderTable();

    const panel = await openFilterPanel(user);

    expect(panel).toBeVisible();
    expect(
      within(panel)
        .getAllByRole('button', { expanded: false })
        .map((button) => button.textContent),
    ).toEqual(['Type', 'Available to']);
  });

  it('say nothing is in force at first: no chip, and the whole list', async () => {
    await renderTable();
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(titles()).toHaveLength(6);
  });
});

describe('narrowing the list by type', () => {
  it('offers every type, and all, with all chosen at first', async () => {
    const { user } = await renderTable();
    expect(await optionsOf(user, 'Type')).toEqual({
      options: [
        'All',
        'Personal information',
        'Credentials',
        'Credit card',
        'Note',
      ],
      chosen: 'All',
    });
  });

  it.each([
    ['Personal information', ['My details']],
    ['Credentials', ['Example shop', 'Bank', 'Mail']],
    ['Credit card', ['Visa ending 4242']],
    ['Note', ['Wi-Fi at the office']],
  ])('shows only the secrets of the type %s', async (name, expected) => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', name);
    expect(titles()).toEqual(expected);
    expect(
      screen.getByText(
        `Showing all ${expected.length} ${expected.length === 1 ? 'secret' : 'secrets'}`,
      ),
    ).toBeInTheDocument();
    expect((await optionsOf(user, 'Type')).chosen).toBe(name);
  });

  it('shows everything again under All', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Note');
    await chooseFilter(user, 'Type', 'All');
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('moves between the types with the arrow keys, which choose as they go', async () => {
    const { user } = await renderTable();
    await optionsOf(user, 'Type');
    screen.getByRole('radio', { name: 'All' }).focus();

    await user.keyboard('{ArrowDown}');

    expect(
      screen.getByRole('radio', { name: 'Personal information' }),
    ).toBeChecked();
    expect(titles()).toEqual(['My details']);
  });

  it('asks the page to show the type, and nothing else', async () => {
    const asked: SecretsFilters[] = [];
    const { user } = await renderTable({}, undefined, (filters) =>
      asked.push(filters),
    );
    await chooseFilter(user, 'Type', 'Credit card');
    expect(asked).toEqual([{ kind: 'card', scope: 'all' }]);
  });
});

describe('narrowing the list by who a secret is available to', () => {
  it('offers all secrets, those for every session, and the sessions that have a secret', async () => {
    const { user } = await renderTable();
    expect(await optionsOf(user, 'Available to')).toEqual({
      options: [
        'All secrets',
        'Every session',
        'Session "0003"',
        'Session "Shop EU"',
      ],
      chosen: 'All secrets',
    });
  });

  it('needs no request for sessions: those the secrets are for are in the list already', async () => {
    const { api } = await renderTable();
    expect(api.callsTo('GET /sessions')).toHaveLength(0);
  });

  it('offers every session that has a secret even when there are hundreds of sessions', async () => {
    const { user } = await renderTable({ sessionsTotal: 730, sessions: [] });
    expect((await optionsOf(user, 'Available to')).options).toEqual([
      'All secrets',
      'Every session',
      'Session "0003"',
      'Session "Shop EU"',
    ]);
  });

  it('shows only the secrets for every session', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Available to', 'Every session');
    expect(titles()).toEqual([
      'Wi-Fi at the office',
      'Example shop',
      'My details',
    ]);
  });

  it("shows only a session's own secrets, not those for every session", async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Available to', 'Session "0003"');
    expect(titles()).toEqual(['Visa ending 4242', 'Mail']);
    expect((await optionsOf(user, 'Available to')).chosen).toBe(
      'Session "0003"',
    );
  });

  it('shows all secrets again under All secrets', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await chooseFilter(user, 'Available to', 'All secrets');
    expect(titles()).toHaveLength(6);
  });

  it('combines the type with the session', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await chooseFilter(user, 'Type', 'Credentials');
    expect(titles()).toEqual(['Mail']);
    await chooseFilter(user, 'Type', 'Credit card');
    expect(titles()).toEqual(['Visa ending 4242']);
  });

  it('counts what is narrowed', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Available to', 'Session "0003"');
    expect(screen.getByText('Showing all 2 secrets')).toBeInTheDocument();
  });

  it('keeps the session the address names even when no secret is for it, by its number', async () => {
    const { user } = await renderTable({}, { kind: 'all', scope: '77' });

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(await optionsOf(user, 'Available to')).toEqual({
      options: [
        'All secrets',
        'Every session',
        'Session "0003"',
        'Session "Shop EU"',
        'Session "77"',
      ],
      chosen: 'Session "77"',
    });
  });
});

describe('the filters in force', () => {
  it('start from what the page holds: the list is narrowed and the chips say how', async () => {
    await renderTable({}, { kind: 'credentials', scope: '3' });

    expect(titles()).toEqual(['Mail']);
    const chips = screen.getByRole('list', { name: 'Active filters' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Type: Credentials', 'Available to: Session "0003"']);
  });

  it('show as a chip for each, with the mark of the type', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Credit card');
    await chooseFilter(user, 'Available to', 'Every session');
    await closeFilterPanel(user);

    expect(chipOf('Type: Credit card')).toBeInTheDocument();
    expect(chipOf('Available to: Every session')).toBeInTheDocument();
  });

  it('lift one filter with its chip, and keep the other', async () => {
    const { user } = await renderTable({}, { kind: 'credentials', scope: '3' });

    await user.click(chipOf('Type: Credentials'));
    expect(titles()).toEqual(['Visa ending 4242', 'Mail']);
    expect(
      screen.queryByRole('button', { name: /Type: Credentials/ }),
    ).toBeNull();
    expect(chipOf('Available to: Session "0003"')).toBeInTheDocument();

    await user.click(chipOf('Available to: Session "0003"'));
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('are lifted by the panel’s Clear all, with the search: it clears whatever narrows the list, as everywhere in Tale', async () => {
    const { user } = await renderTable({}, { kind: 'credentials', scope: '3' });
    await user.click(search());
    await user.type(search(), 'mail');
    expect(titles()).toEqual(['Mail']);

    const panel = await openFilterPanel(user);
    await user.click(within(panel).getByRole('button', { name: 'Clear all' }));

    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    await waitFor(() => expect(titles()).toHaveLength(6));
    expect(search()).toHaveValue('');
  });

  it('offers Clear filters only while something narrows the list', async () => {
    const { user } = await renderTable();
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument();

    await user.click(search());
    await user.type(search(), 'mail');
    expect(
      screen.getByRole('button', { name: 'Clear filters' }),
    ).toBeInTheDocument();

    await user.clear(search());
    expect(
      screen.queryByRole('button', { name: 'Clear filters' }),
    ).not.toBeInTheDocument();
    await chooseFilter(user, 'Type', 'Note');
    expect(
      screen.getByRole('button', { name: 'Clear filters' }),
    ).toBeInTheDocument();
  });

  it('are lifted, with the search, by Clear filters of the toolbar', async () => {
    const asked: SecretsFilters[] = [];
    const { user } = await renderTable(
      {},
      { kind: 'credentials', scope: '3' },
      (filters) => asked.push(filters),
    );
    await user.click(search());
    await user.type(search(), 'zzzz');
    await screen.findByText('No results found');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(search()).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(titles()).toHaveLength(6);
    // Whatever order the pieces were lifted in, the last word is "nothing".
    expect(asked.at(-1)).toEqual({ kind: 'all', scope: 'all' });
  });

  it('lift together when two of them are lifted at once: neither undoes the other', async () => {
    const { user } = await renderTable({}, { kind: 'credentials', scope: '3' });
    const panel = await openFilterPanel(user);
    await user.click(within(panel).getByRole('button', { name: 'Clear all' }));
    expect(titles()).toHaveLength(6);
    expect(filterButton()).toBeInTheDocument();
  });
});

describe('a list the type or the session narrows to nothing', () => {
  it('says that nothing matches, not that there are no secrets, and the chips are there to undo it', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Note');
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await closeFilterPanel(user);

    expect(
      await screen.findByRole('heading', { name: 'No results found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Try adjusting your search criteria'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No secrets yet')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Visa ending 4242' }),
    ).not.toBeInTheDocument();

    await user.click(chipOf('Type: Note'));
    expect(titles()).toEqual(['Visa ending 4242', 'Mail']);
  });

  it('offers all the secrets again, which lifts the type and the session', async () => {
    const asked: SecretsFilters[] = [];
    const { user } = await renderTable(
      {},
      { kind: 'note', scope: '3' },
      (filters) => asked.push(filters),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Show all secrets' }),
    );

    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(asked.at(-1)).toEqual({ kind: 'all', scope: 'all' });
  });

  it('keeps the filters, so they can be changed from there', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Note');
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await chooseFilter(user, 'Type', 'Credit card');
    expect(titles()).toEqual(['Visa ending 4242']);
  });

  it('does not offer to show all of them for a search that finds nothing: there is the search to clear', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'zzzz');

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show all secrets' }),
    ).not.toBeInTheDocument();
  });
});

describe('searching the list', () => {
  it('finds a secret by its title', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'wi-fi');
    expect(titles()).toEqual(['Wi-Fi at the office']);
    expect(screen.getByText('Showing 1 of 6 secrets')).toBeInTheDocument();
  });

  it('finds a secret by its details', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'shop.example.com');
    expect(titles()).toEqual(['Example shop']);
  });

  it('finds the secrets of a type by the name of the type, as the row says it', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'credit card');
    expect(titles()).toEqual(['Visa ending 4242']);
  });

  it('finds the secrets of a session by the name of the session', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'shop eu');
    expect(titles()).toEqual(['Bank']);
  });

  it('searches within the type and the session that are chosen', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Credentials');
    await closeFilterPanel(user);
    await user.click(search());
    await user.type(search(), 'ada@example');
    // "My details" has the same address, but it is not a credential.
    expect(titles()).toEqual(['Example shop']);
  });

  it('cannot find a hidden value by typing it, since the page does not have it', async () => {
    const { user } = await renderTable();
    await user.click(search());
    await user.type(search(), 'hunter2');
    expect(await screen.findByText('No results found')).toBeInTheDocument();
  });

  it('says nothing matches and offers to clear the search, the type and the session', async () => {
    const { user } = await renderTable({}, { kind: 'credentials', scope: '3' });
    await user.click(search());
    await user.type(search(), 'zzzz');

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(search()).toHaveValue('');
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(titles()).toHaveLength(6);
  });
});

describe('the list before it has any secret', () => {
  it('explains what secrets are for and who can use them, and offers to add the first', async () => {
    await renderTable({ secrets: [] });
    expect(
      await screen.findByRole('heading', { name: 'No secrets yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add logins, cards, personal details and notes to fill in pages with a click. Connected AI assistants can use them too.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add secret' }),
    ).toBeInTheDocument();
  });

  it('has one Add button and nothing to search or narrow', async () => {
    await renderTable({ secrets: [] });
    await screen.findByRole('heading', { name: 'No secrets yet' });
    expect(screen.getAllByRole('button', { name: 'Add secret' })).toHaveLength(
      1,
    );
    expect(
      screen.queryByRole('textbox', { name: 'Search secrets' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Filter' }),
    ).not.toBeInTheDocument();
  });

  it('says there are no secrets, not that none match, whatever the address narrows to', async () => {
    await renderTable({ secrets: [] }, { kind: 'note', scope: '3' });
    expect(
      await screen.findByRole('heading', { name: 'No secrets yet' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
  });

  it('brings the toolbar back with the first secret', async () => {
    const { state, queryClient } = await renderTable({ secrets: [] });
    await screen.findByRole('heading', { name: 'No secrets yet' });

    state.secrets = [SAMPLE.credentials];
    await queryClient.invalidateQueries({ queryKey: SECRET_LISTS });

    expect(
      await screen.findByRole('button', { name: 'Example shop' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Search secrets' }),
    ).toBeInTheDocument();
    expect(filterButton()).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add secret' })).toHaveLength(
      1,
    );
  });
});

describe('the list while it loads', () => {
  it('masks its rows in place, with the toolbar already there', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets', () => new Promise(() => {}));
    renderApp(<HeldSecretsTable />);

    expect(
      screen.getByRole('status', { name: 'Loading content' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Search secrets' }),
    ).toBeInTheDocument();
    expect(filterButton()).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'No secrets yet' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    await checkAccessibility(document.body);
  });
});

describe('a list that cannot be read', () => {
  it('says so and reads it again on request', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets', failure(500, 'internal', 'boom'));
    const { user } = renderApp(<HeldSecretsTable />);

    // The words of this page, as the sessions have them, not the library's
    // "Something went wrong" with a link to a support page of its own.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the secrets.");
    expect(alert).not.toHaveTextContent('incomplete or out of date');
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // A list that could not be read is not an empty one, and has no toolbar.
    expect(
      screen.queryByRole('heading', { name: 'No secrets yet' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add secret' }),
    ).not.toBeInTheDocument();

    backend.api.on('GET /secrets', () => backend.state.secrets.map(summaryOf));
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(
      await screen.findByRole('button', { name: 'Example shop' }),
    ).toBeInTheDocument();
    expect(titles()).toHaveLength(6);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The retry held the focus and went with the alert: the list takes it.
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Secrets' })).toHaveFocus(),
    );
  });

  it('adds the cause to the first failure too, when trying again does not mend it', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets', failure(403, 'forbidden_host', 'x'));
    renderApp(<HeldSecretsTable />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load the secrets. Open Session Manager at 127.0.0.1 or localhost.",
    );
  });

  it('keeps the rows and says the refresh failed, with a way to try again', async () => {
    const { user, api, queryClient } = await renderTable();
    api.on('GET /secrets', failure(503, 'network'));
    await queryClient.invalidateQueries({ queryKey: SECRET_LISTS });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't load the latest secrets. What's listed may be incomplete or out of date.",
    );
    expect(alert).not.toHaveTextContent("Can't reach Session Manager");
    expect(titles()).toHaveLength(6);

    api.on('GET /secrets', () => installedList());
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
    expect(titles()).toHaveLength(6);
  });

  it('keeps what the person narrowed to through a failed refresh', async () => {
    const { api, queryClient } = await renderTable(
      {},
      { kind: 'note', scope: 'all' },
    );
    api.on('GET /secrets', failure(503, 'network'));
    await queryClient.invalidateQueries({ queryKey: SECRET_LISTS });
    await screen.findByRole('alert');
    expect(titles()).toEqual(['Wi-Fi at the office']);
    expect(chipOf('Type: Note')).toBeInTheDocument();
  });

  it('has no accessibility violations with the rows and the failure on one page', async () => {
    const { api, queryClient } = await renderTable();
    api.on('GET /secrets', failure(503, 'network'));
    await queryClient.invalidateQueries({ queryKey: SECRET_LISTS });
    await screen.findByRole('alert');
    await checkAccessibility(document.body);
  });
});

describe('the list in German', () => {
  it('reads in German: headings, filters, count and ages', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSecretsApi();
    const { user } = renderApp(<HeldSecretsTable />);

    expect(
      await screen.findByRole('table', { name: 'Secrets' }),
    ).toBeInTheDocument();
    const headers = await screen.findAllByRole('columnheader');
    await waitFor(() =>
      expect(headers.map((header) => header.textContent)).toContain('Titel'),
    );
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toEqual([
      'Titel',
      'Typ',
      'Verfügbar für',
      'Details',
      'Aktualisiert',
      'Aktionen für die Zeile',
    ]);
    expect(
      screen.getAllByText('Jede Sitzung', { selector: 'span' }),
    ).toHaveLength(3);
    expect(
      screen.getByRole('button', { name: 'Secret hinzufügen' }),
    ).toBeInTheDocument();

    // The panel: its groups and their options, in German.
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const panel = await screen.findByRole('dialog', { name: 'Filter' });
    const groups = within(panel).getAllByRole('button', { expanded: false });
    expect(groups.map((group) => group.textContent)).toEqual([
      'Typ',
      'Verfügbar für',
    ]);
    await user.click(groups[0]);
    expect(
      within(panel).getByRole('radio', { name: 'Persönliche Angaben' }),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole('radio', { name: 'Kreditkarte' }));
    expect(
      screen.getByRole('button', {
        name: 'Filter Typ: Kreditkarte entfernen',
      }),
    ).toBeInTheDocument();
    // Its own words for lifting them in the toolbar: the library's "Alle löschen"
    // reads as "delete all" (the panel's own link, closed again here, still says so).
    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'Filter zurücksetzen' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Alle löschen' }),
    ).not.toBeInTheDocument();
  });

  it('finds a secret by the type as the German row says it', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSecretsApi();
    const { user } = renderApp(<HeldSecretsTable />);
    await screen.findByRole('textbox', { name: /Secrets suchen/ });
    await screen.findByRole('button', { name: 'Example shop' });
    await user.click(screen.getByRole('textbox', { name: /Secrets suchen/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Secrets suchen/ }),
      'kreditkarte',
    );
    await waitFor(() => expect(titles()).toEqual(['Visa ending 4242']));
  });

  it('says there is nothing yet in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSecretsApi({ secrets: [] });
    renderApp(<HeldSecretsTable />);
    expect(
      await screen.findByRole('heading', { name: 'Noch keine Secrets' }),
    ).toBeInTheDocument();
  });
});

describe('the list in French', () => {
  it('reads the filters and the chips in French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    installSecretsApi();
    renderApp(<HeldSecretsTable initial={{ kind: 'card', scope: '3' }} />);

    expect(
      await screen.findByRole('button', { name: 'Visa ending 4242' }),
    ).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'Filtres actifs' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Type\u00a0: Carte bancaire',
      'Disponible pour\u00a0: Session «\u00a00003\u00a0»',
    ]);
    // Its own words for lifting them, not the library's "Tout effacer".
    expect(
      screen.getByRole('button', { name: 'Effacer les filtres' }),
    ).toBeInTheDocument();
  });
});

describe('the list in a column too narrow for its columns', () => {
  it('has the columns while the column is as wide as they need, and not a pixel less', async () => {
    const stub = columnIs(SECRETS_TABLE_MIN_WIDTH);
    await renderTable();
    const table = screen.getByRole('table', { name: 'Secrets' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Title',
      'Type',
      'Available to',
      'Details',
      'Updated',
      'Row actions',
    ]);

    stub.resize(SECRETS_TABLE_MIN_WIDTH - 1);
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Secrets' }))
          .getAllByRole('columnheader')
          .map((header) => header.textContent),
      ).toEqual(['Title', 'Row actions']),
    );
  });

  it('gives who a secret is for more room as the column widens, and only beyond the columns it has', async () => {
    const stub = columnIs(1000);
    await renderTable();
    expect(widthOf('Available to')).toBe('154px');
    expect(widthOf('Title')).toBe('240px');

    stub.resize(1040);
    await waitFor(() => expect(widthOf('Available to')).toBe('174px'));

    stub.resize(1100);
    await waitFor(() => expect(widthOf('Available to')).toBe('200px'));
    // Nothing else moved: the title, the type and the age keep their room, and the details the slack.
    expect(widthOf('Title')).toBe('240px');
    expect(widthOf('Type')).toBe('194px');
    expect(widthOf('Updated')).toBe('188px');

    stub.resize(1999);
    await waitFor(() => expect(widthOf('Available to')).toBe('200px'));

    stub.resize(999);
    await waitFor(() => expect(widthOf('Available to')).toBe('154px'));
  });

  it('has the same columns, as narrow as they need, in a column of 1024px windows', async () => {
    columnIs(1024 - 52 - 32);
    await renderTable();
    expect(
      within(screen.getByRole('table', { name: 'Secrets' }))
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual([
      'Title',
      'Type',
      'Available to',
      'Details',
      'Updated',
      'Row actions',
    ]);
    expect(widthOf('Available to')).toBe('154px');
  });

  it('has the title and the menu only, the type and who it is for under the title', async () => {
    columnIs(356);
    await renderTable();
    const table = screen.getByRole('table', { name: 'Secrets' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Title', 'Row actions']);
    const row = rowOf('Example shop');
    expect(
      within(row).getByText('Credentials · Every session'),
    ).toBeInTheDocument();
    const visa = rowOf('Visa ending 4242');
    expect(
      within(visa).getByText('Credit card · Session "0003"'),
    ).toBeInTheDocument();
  });

  it('follows the column as it is resized, both ways', async () => {
    const stub = columnIs(1200);
    await renderTable();
    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent),
    ).toContain('Details');

    stub.resize(600);
    await waitFor(() =>
      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toEqual(['Title', 'Row actions']),
    );

    stub.resize(1200);
    await waitFor(() =>
      expect(
        screen.getAllByRole('columnheader').map((header) => header.textContent),
      ).toContain('Details'),
    );
  });

  it('keeps the same Filter button, the chips and the rows’ menus', async () => {
    columnIs(356);
    const { user } = await renderTable(
      {},
      { kind: 'credentials', scope: 'all' },
    );

    expect(filterButton()).toBeInTheDocument();
    expect(chipOf('Type: Credentials')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Mail' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});

describe('the filter panel and the keyboard', () => {
  it('opens from the keyboard on its first group, and Escape gives the focus back to the Filter button', async () => {
    const { user } = await renderTable();

    filterButton().focus();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Filters' });
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Type' })).toHaveFocus(),
    );

    await user.keyboard('{Escape}');
    await waitFor(() => expect(filterPanel()).toBeNull());
    expect(filterButton()).toHaveFocus();
  });

  it('reaches every type from the keyboard and chooses with Space', async () => {
    const { user } = await renderTable();
    filterButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Filters' });

    await user.keyboard('{Enter}');
    await user.tab();
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Credentials' })).toBeChecked();
    expect(titles()).toEqual(['Example shop', 'Bank', 'Mail']);
  });

  it('is left open while a filter is chosen, so the next one can be chosen too', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Note');
    expect(filterPanel()).not.toBeNull();
    await chooseFilter(user, 'Available to', 'Every session');
    expect(titles()).toEqual(['Wi-Fi at the office']);
  });
});

describe('the list and its accessibility', () => {
  it('has no violations when it has secrets, when the filter panel is open, and when it found nothing', async () => {
    const { user } = await renderTable();
    await checkAccessibility(document.body);

    await chooseFilter(user, 'Type', 'Credentials');
    await chooseFilter(user, 'Available to', 'Session "0003"');
    // The panel is open, with its two groups open and a chip behind it.
    await checkAccessibility(document.body);
    await closeFilterPanel(user);
    await checkAccessibility(document.body);

    await user.click(chipOf('Type: Credentials'));
    await user.click(search());
    await user.type(search(), 'zzzz');
    await screen.findByText('No results found');
    await checkAccessibility(document.body);
  });

  it('has no violations while empty and when it cannot be read', async () => {
    const backend = installSecretsApi({ secrets: [] });
    const first = renderApp(<HeldSecretsTable />);
    await screen.findByRole('heading', { name: 'No secrets yet' });
    await checkAccessibility(document.body);
    first.unmount();

    backend.api.on('GET /secrets', failure(500, 'internal'));
    renderApp(<HeldSecretsTable />);
    await screen.findByRole('button', { name: 'Try again' });
    await checkAccessibility(document.body);
  });

  it('has no violations in the narrow layout', async () => {
    columnIs(356);
    await renderTable({}, { kind: 'all', scope: '3' });
    await checkAccessibility(document.body);
  });
});
