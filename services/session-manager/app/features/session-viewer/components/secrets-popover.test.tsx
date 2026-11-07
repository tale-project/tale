import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Secret } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import {
  meta,
  secret,
  secretSummary,
  session as sessionBuilder,
} from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';
import { installSecretsApi, summaryOf } from '@/tests/utils/secrets-api';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/7');
});

import { SecretsPopover } from './secrets-popover';

afterEach(() => {
  vi.useRealTimers();
});

const own = sessionBuilder({ id: 7, name: 'Shop', status: 'running' });

const summaries = [
  secretSummary({
    id: 1,
    kind: 'credentials',
    title: 'Example login',
    preview: 'example.com · ada',
  }),
  secretSummary({
    id: 2,
    kind: 'credentials',
    title: 'Forum',
    preview: 'forum.example.org · ada.l',
    session: { id: 7, name: 'Shop', status: 'running' },
  }),
  secretSummary({
    id: 3,
    kind: 'personal',
    title: 'My details',
    preview: 'Ada Lovelace',
  }),
];

const login = secret({
  id: 1,
  fields: [
    { label: 'Website', value: 'example.com', hidden: false },
    { label: 'Username', value: 'ada', hidden: false },
    { label: 'Password', value: 'correct horse\nbattery', hidden: true },
    { label: 'Pin', value: '', hidden: true },
  ],
});

function api(routes: Record<string, unknown> = {}) {
  return installFakeApi({
    'GET /meta': meta(),
    'GET /secrets': summaries,
    'GET /secrets/:id': ({ params }) =>
      params.id === '1' ? login : secret({ id: Number(params.id) }),
    ...routes,
  });
}

function setup(
  props: Partial<React.ComponentProps<typeof SecretsPopover>> = {},
) {
  const onType = vi.fn();
  return {
    ...renderApp(
      <>
        <SecretsPopover
          sessionId={own.id}
          sessionName={own.name}
          onType={onType}
          {...props}
        />
        <ToastProbe />
      </>,
    ),
    onType,
  };
}

/** What the button at the foot of the popover says, for the session of these tests. */
const ADD_FOR_SHOP = 'Add secret for "Shop"';

const open = async (user: ReturnType<typeof setup>['user']) => {
  await user.click(
    screen.getByRole('button', { name: 'Secrets for this session' }),
  );
  return screen.findByRole('dialog', { name: 'Secrets for this session' });
};

describe('SecretsPopover', () => {
  it('is a button that opens a dialog', async () => {
    api();
    const { user } = setup();
    const button = screen.getByRole('button', {
      name: 'Secrets for this session',
    });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await open(user);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('says Secrets, and is named after the object it opens, which the Secrets of the app are not', () => {
    api();
    setup();
    const button = screen.getByRole('button', {
      name: 'Secrets for this session',
    });
    // The words of the button are in its name: a voice command for "Secrets" reaches it.
    expect(button).toHaveTextContent('Secrets');
    expect(screen.queryByRole('button', { name: 'Secrets' })).toBeNull();
  });

  it('reads the secrets of this session and the ones for every session, not before it is opened', async () => {
    const fake = api();
    const { user } = setup();
    expect(fake.callsTo('GET /secrets')).toHaveLength(0);
    await open(user);
    await screen.findByText('Example login');
    const [call] = fake.callsTo('GET /secrets');
    expect(call?.query.get('scope')).toBe('7');
    expect(call?.query.get('includeGlobal')).toBe('true');
  });

  it('lists them in groups by kind, each with whose it is', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    const personal = await within(dialog).findByRole('region', {
      name: 'Personal information',
    });
    expect(within(personal).getByText('My details')).toBeVisible();
    expect(within(personal).getByText('Ada Lovelace')).toBeVisible();
    const credentials = within(dialog).getByRole('region', {
      name: 'Credentials',
    });
    const items = within(credentials).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Every session')).toBeVisible();
    expect(within(items[1]).getByText('This session')).toBeVisible();
    // A kind without a secret has no group.
    expect(
      within(dialog).queryByRole('region', { name: 'Credit card' }),
    ).toBeNull();
  });

  it('says that it loads, then lists', async () => {
    api({ 'GET /secrets': async () => new Promise(() => {}) });
    const { user } = setup();
    const dialog = await open(user);
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading…');
  });

  it('says that the secrets could not be read, and tries again', async () => {
    let fail = true;
    api({
      'GET /secrets': () => (fail ? failure(503, 'network') : summaries),
    });
    const { user } = setup();
    const dialog = await open(user);
    const alert = await within(dialog).findByRole('alert');
    // What failed; the button says to try again and the banner of the page why the server is out of reach.
    expect(alert).toHaveTextContent("Couldn't load the secrets.");
    expect(alert).not.toHaveTextContent("Can't reach");
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('Example login')).toBeVisible();
  });

  it('opens a secret to its values, reading them only then', async () => {
    const fake = api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Example login');
    expect(fake.callsTo('GET /secrets/:id')).toHaveLength(0);
    const item = within(dialog).getByRole('button', { name: /Example login/ });
    expect(item).toHaveAttribute('aria-expanded', 'false');
    await user.click(item);
    expect(item).toHaveAttribute('aria-expanded', 'true');
    expect(await within(dialog).findByText('example.com')).toBeVisible();
    expect(within(dialog).getByText('Website')).toBeVisible();
    expect(within(dialog).getByText('ada')).toBeVisible();
    expect(fake.callsTo('GET /secrets/:id')).toHaveLength(1);
    await user.click(item);
    expect(item).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByText('ada')).toBeNull();
  });

  it('keeps a masked value as dots until it is shown, and hides it again', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await within(dialog).findByText('Password');
    // The dots are for the eye; the screen reader is told it is hidden.
    expect(within(dialog).queryByText('correct horse')).toBeNull();
    expect(within(dialog).getAllByText('Hidden value').length).toBeGreaterThan(
      0,
    );
    const toggle = within(dialog).getByRole('button', {
      name: 'Show Password',
    });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Only the first line of a value fits the list; a count says there is more.
    expect(within(dialog).getByText('correct horse')).toBeVisible();
    expect(within(dialog).getByText('+1 line')).toBeVisible();
    await user.click(toggle);
    expect(within(dialog).queryByText('correct horse')).toBeNull();
    // A masked value says nothing of its shape, not even how many lines it has.
    expect(within(dialog).queryByText('+1 line')).toBeNull();
  });

  it('has no toggle for a value that is not masked', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await within(dialog).findByText('Username');
    expect(
      within(dialog).queryByRole('button', { name: 'Show Username' }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole('button', { name: 'Show Website' }),
    ).toBeNull();
  });

  it('types a value into the window, in full, and gives the keyboard back to its button', async () => {
    api();
    const { user, onType } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Type Password into the window',
      }),
    );
    // The whole value, with its second line, though the list shows the first.
    expect(onType).toHaveBeenCalledExactlyOnceWith('correct horse\nbattery');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Secrets for this session' }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
  });

  it('types a value that is not masked', async () => {
    api();
    const { user, onType } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Type Username into the window',
      }),
    );
    expect(onType).toHaveBeenCalledExactlyOnceWith('ada');
  });

  it('copies a value, masked or not, to the clipboard', async () => {
    api();
    const { user, onType } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await user.click(
      await within(dialog).findByRole('button', { name: 'Copy Password' }),
    );
    expect(await navigator.clipboard.readText()).toBe('correct horse\nbattery');
    expect(onType).not.toHaveBeenCalled();
  });

  it('cannot type or copy a value that is empty', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await within(dialog).findByText('Pin');
    expect(within(dialog).getByText('Empty')).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Type Pin into the window' }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Copy Pin' }),
    ).toBeDisabled();
  });

  it('says that the values could not be read, and tries again', async () => {
    let fail = true;
    api({
      'GET /secrets/:id': () =>
        fail ? failure(404, 'secret_not_found') : login,
    });
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    const alert = await within(dialog).findByRole('alert');
    // A cause that trying again does not mend follows what failed.
    expect(alert).toHaveTextContent(
      "Couldn't load the values. This secret no longer exists.",
    );
    fail = false;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(dialog).findByText('example.com')).toBeVisible();
  });

  it('says only that the values could not be read when the server is out of reach', async () => {
    api({ 'GET /secrets/:id': () => failure(503, 'network') });
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the values.");
    expect(alert).not.toHaveTextContent("Can't reach");
  });

  it('explains how to add a secret when there are none, and offers it right there', async () => {
    api({ 'GET /secrets': [] });
    const { user } = setup();
    const dialog = await open(user);
    expect(
      await within(dialog).findByText('No secrets for this session yet'),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        'Add logins, cards, personal details and notes to fill in pages with a click.',
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: ADD_FOR_SHOP }),
    ).toBeVisible();
    // Nothing to manage yet, and no way out of the session.
    expect(within(dialog).queryByRole('link')).toBeNull();
  });

  it('lets the keyboard reach an empty list, which scrolls where the room is short', async () => {
    api({ 'GET /secrets': [] });
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('No secrets for this session yet');
    const list = within(dialog).getByRole('region', {
      name: 'Secrets for this session',
    });
    expect(list).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(list).toHaveFocus();
  });

  it('leaves the keyboard to the rows of a list that has secrets', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByRole('button', { name: /Example login/ });
    expect(
      within(dialog).queryByRole('region', {
        name: 'Secrets for this session',
      }),
    ).toBeNull();
  });

  it('links to the Secrets page from a list that has secrets, to change or delete one', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Example login');
    expect(
      within(dialog).getByRole('link', { name: 'Manage secrets' }),
    ).toHaveAttribute('href', '/secrets');
    expect(
      within(dialog).getByRole('button', { name: ADD_FOR_SHOP }),
    ).toBeVisible();
  });

  it('closes with Escape and gives the keyboard back to its button', async () => {
    api();
    const { user } = setup();
    await open(user);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Secrets for this session' }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
  });

  it('speaks German', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    try {
      api();
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', {
          name: 'Secrets für diese Sitzung',
        }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: 'Secrets für diese Sitzung',
      });
      expect(
        await within(dialog).findByRole('button', { name: /Example login/ }),
      ).toBeVisible();
      expect(
        within(dialog).getAllByText('Jede Sitzung').length,
      ).toBeGreaterThan(0);
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('words the kinds of secret and their fields in the language of the person, not in the English of the server', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    try {
      for (const [locale, personal, credentials, field, show] of [
        [
          'de',
          'Persönliche Angaben',
          'Zugangsdaten',
          'Passwort',
          'Passwort anzeigen',
        ],
        [
          'fr',
          'Informations personnelles',
          'Identifiants',
          'Mot de passe',
          'Afficher «\u00a0Mot de passe\u00a0»',
        ],
      ] as const) {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        api();
        const { user, unmount } = setup();
        await user.click(
          await screen.findByRole('button', { name: /Secrets/ }),
        );
        const dialog = await screen.findByRole('dialog');
        // The headings of the groups, which the server words in English only.
        expect(
          await within(dialog).findByRole('region', { name: personal }),
        ).toBeVisible();
        expect(
          within(dialog).getByRole('region', { name: credentials }),
        ).toBeVisible();
        expect(within(dialog).queryByText('Credentials')).toBeNull();
        // And the labels of the fields of a secret that is opened, and the buttons named after them.
        await user.click(
          await within(dialog).findByRole('button', { name: /Example login/ }),
        );
        expect(await within(dialog).findByText(field)).toBeVisible();
        expect(within(dialog).queryByText('Password')).toBeNull();
        expect(
          within(dialog).getByRole('button', { name: show }),
        ).toBeVisible();
        unmount();
      }
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('shows a field label that no catalog knows as it was typed', async () => {
    api({
      'GET /secrets/:id': secret({
        id: 1,
        fields: [{ label: 'Backup phrase', value: 'x y z', hidden: false }],
      }),
    });
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    expect(await within(dialog).findByText('Backup phrase')).toBeVisible();
    expect(
      within(dialog).getByRole('button', {
        name: 'Type Backup phrase into the window',
      }),
    ).toBeVisible();
  });

  it('has no accessibility violations with a secret opened', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    await within(dialog).findByText('Password');
    await checkAccessibility(document.body);
  });

  it('has no accessibility violations when there are no secrets', async () => {
    api({ 'GET /secrets': [] });
    const { user } = setup();
    await open(user);
    await screen.findByText('No secrets for this session yet');
    await checkAccessibility(document.body);
  });
});

describe('SecretsPopover list', () => {
  const rowOf = (dialog: HTMLElement, name: string) =>
    within(dialog).getByRole('button', { name, expanded: false });

  it('names a row by its title and describes it by whose it is and what it holds', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Forum');
    const row = rowOf(dialog, 'Forum');
    expect(row).toHaveAccessibleName('Forum');
    expect(row).toHaveAccessibleDescription(
      'This session forum.example.org · ada.l',
    );
    expect(rowOf(dialog, 'My details')).toHaveAccessibleDescription(
      'Every session Ada Lovelace',
    );
  });

  it('shows a title that is cut short whole when the pointer rests on it', async () => {
    api({
      'GET /secrets': [
        secretSummary({
          id: 9,
          title: 'A very long title for a login that goes on and on and on',
          preview: 'https://a-very-long-domain-name.example.com/account',
        }),
      ],
    });
    const { user } = setup();
    const dialog = await open(user);
    expect(
      await within(dialog).findByText(
        'A very long title for a login that goes on and on and on',
      ),
    ).toHaveAttribute(
      'title',
      'A very long title for a login that goes on and on and on',
    );
  });

  it('moves between the secrets with the arrow keys, round the ends, and to the first and the last with Home and End', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Forum');
    const [first, second, third] = ['My details', 'Example login', 'Forum'].map(
      (name) => rowOf(dialog, name),
    );
    first.focus();

    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(third).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
  });

  it('puts the keyboard on the first secret once the list has been read, so that an arrow key goes on from there', async () => {
    api();
    const { user } = setup();
    screen.getByRole('button', { name: 'Secrets for this session' }).focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', {
      name: 'Secrets for this session',
    });
    await within(dialog).findByText('Forum');

    await waitFor(() => expect(rowOf(dialog, 'My details')).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(rowOf(dialog, 'Example login')).toHaveFocus();
  });

  it('leaves the arrow keys alone inside an opened secret, where they are the controls own', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Example login/ }),
    );
    const copy = await within(dialog).findByRole('button', {
      name: 'Copy Website',
    });
    copy.focus();
    await user.keyboard('{ArrowDown}');
    expect(copy).toHaveFocus();
  });

  it('keeps the heading and the buttons at the foot in place, and scrolls only the list', async () => {
    api();
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Forum');
    const heading = within(dialog).getByRole('heading', { level: 2 });
    const add = within(dialog).getByRole('button', { name: ADD_FOR_SHOP });
    const manage = within(dialog).getByRole('link', { name: 'Manage secrets' });
    const groups = within(dialog).getAllByRole('region');
    const scroller = groups[0]?.parentElement;
    expect(scroller).not.toBeNull();
    for (const group of groups) expect(scroller).toContainElement(group);
    for (const fixed of [heading, add, manage]) {
      expect(scroller).not.toContainElement(fixed);
    }
  });

  it('lists a long list whole, in its groups, for the list to scroll', async () => {
    const many = Array.from({ length: 18 }, (_unused, index) =>
      secretSummary({
        id: 100 + index,
        kind: index % 2 === 0 ? 'credentials' : 'note',
        title: `Secret ${index + 1}`,
        preview: `preview ${index + 1}`,
      }),
    );
    api({ 'GET /secrets': many });
    const { user } = setup();
    const dialog = await open(user);
    await within(dialog).findByText('Secret 1');
    expect(
      within(dialog).getAllByRole('button', { name: /^Secret \d+$/ }),
    ).toHaveLength(18);
    expect(
      within(dialog).getByRole('button', { name: ADD_FOR_SHOP }),
    ).toBeVisible();
  });

  it('puts the empty state under a heading of its own, with a mark', async () => {
    api({ 'GET /secrets': [] });
    const { user } = setup();
    const dialog = await open(user);
    expect(
      await within(dialog).findByRole('heading', {
        level: 3,
        name: 'No secrets for this session yet',
      }),
    ).toBeVisible();
  });
});

describe('SecretsPopover values', () => {
  const address = secret({
    id: 5,
    kind: 'personal',
    title: 'Home',
    fields: [
      { label: 'Name', value: 'Ada Lovelace', hidden: false },
      {
        label: 'Address',
        value: 'Main Street 1\n12345 Town\nGermany',
        hidden: false,
      },
      { label: 'Notes', value: 'One line only\n', hidden: false },
    ],
  });

  async function openAddress(
    user: ReturnType<typeof setup>['user'],
    summary = secretSummary({ id: 5, kind: 'personal', title: 'Home' }),
  ) {
    api({
      'GET /secrets': [summary],
      'GET /secrets/:id': address,
    });
    const dialog = await open(user);
    await user.click(
      await within(dialog).findByRole('button', { name: /Home/ }),
    );
    await within(dialog).findByText('Address');
    return dialog;
  }

  it('names the group of values after its secret', async () => {
    const { user } = setup();
    const dialog = await openAddress(user);
    expect(within(dialog).getByRole('group', { name: 'Home' })).toBeVisible();
  });

  it('shows the first line of a value of several, and how many more it has', async () => {
    const { user } = setup();
    const dialog = await openAddress(user);
    expect(
      within(dialog).getByText('Main Street 1', { exact: true }),
    ).toBeVisible();
    expect(within(dialog).getByText('+2 lines')).toBeVisible();
    // A value of one line, and one that only ends in a line break, have none to count.
    expect(within(dialog).getAllByText(/^\+\d+ lines?$/)).toHaveLength(1);
  });

  it('types and copies the whole value, not the line that is shown', async () => {
    const { user, onType } = setup();
    const dialog = await openAddress(user);
    await user.click(
      within(dialog).getByRole('button', { name: 'Copy Address' }),
    );
    expect(await navigator.clipboard.readText()).toBe(
      'Main Street 1\n12345 Town\nGermany',
    );
    await user.click(
      within(dialog).getByRole('button', {
        name: 'Type Address into the window',
      }),
    );
    expect(onType).toHaveBeenCalledExactlyOnceWith(
      'Main Street 1\n12345 Town\nGermany',
    );
  });

  it('counts the lines in German and in French, in the singular too', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    try {
      for (const [locale, popoverName, expected, singular] of [
        ['de', 'Secrets für diese Sitzung', '+2 Zeilen', '+1 Zeile'],
        ['fr', 'Secrets pour cette session', '+2 lignes', '+1 ligne'],
      ] as const) {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
        api({
          'GET /secrets': [
            secretSummary({ id: 5, kind: 'personal', title: 'Home' }),
          ],
          'GET /secrets/:id': secret({
            id: 5,
            fields: [
              { label: 'Address', value: 'a\nb\nc', hidden: false },
              { label: 'Other', value: 'a\nb', hidden: false },
            ],
          }),
        });
        const { user, unmount } = setup();
        await user.click(
          await screen.findByRole('button', { name: popoverName }),
        );
        const dialog = await screen.findByRole('dialog', { name: popoverName });
        await user.click(
          await within(dialog).findByRole('button', { name: /Home/ }),
        );
        expect(await within(dialog).findByText(expected)).toBeVisible();
        expect(within(dialog).getByText(singular)).toBeVisible();
        unmount();
      }
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('brings the values of a secret into view when they have been read, as far as a list that scrolls needs', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    scrollIntoView.mockClear();
    const { user } = setup();
    const dialog = await openAddress(user);

    const group = within(dialog).getByRole('group', { name: 'Home' });
    const called = scrollIntoView.mock.contexts.indexOf(group);
    expect(called).toBeGreaterThanOrEqual(0);
    expect(scrollIntoView.mock.calls[called]).toEqual([{ block: 'nearest' }]);
  });

  it('has no accessibility violations with a secret of several lines opened', async () => {
    const { user } = setup();
    await openAddress(user);
    await checkAccessibility(document.body);
  });
});

/** The secrets API over a list the test owns, answering as the server does: this session's secrets and the ones for every session. */
function serveSecrets(
  secrets: Secret[] = [
    secret({ id: 1, title: 'Example login', session: null }),
    secret({
      id: 2,
      title: 'Forum',
      session: { id: 7, name: 'Shop', status: 'running' },
    }),
    secret({
      id: 3,
      title: 'Beta only',
      session: { id: 8, name: 'Mail', status: 'stopped' },
    }),
  ],
) {
  const served = installSecretsApi({
    secrets,
    sessions: [own, sessionBuilder({ id: 8, name: 'Mail' })],
  });
  served.api.on('GET /secrets', ({ query }) =>
    served.state.secrets
      .filter(
        (entry) =>
          entry.session === null ||
          entry.session.id === Number(query.get('scope')),
      )
      .map(summaryOf),
  );
  return served;
}

const formOf = () => screen.findByRole('dialog', { name: 'Add secret' });
const noForm = () =>
  waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Add secret' })).toBeNull(),
  );

/** Opens the popover, then the form for the session, as a person does. */
async function openForm(user: ReturnType<typeof setup>['user']) {
  const popover = await open(user);
  await user.click(
    await within(popover).findByRole('button', { name: ADD_FOR_SHOP }),
  );
  return formOf();
}

describe('SecretsPopover adding a secret for the session', () => {
  it('opens the form in a dialog over the page, with this session chosen, and the popover gives way', async () => {
    serveSecrets();
    const { user } = setup();
    const form = await openForm(user);

    expect(form).toBeVisible();
    // The person is not taken anywhere: the form is on the page they are on.
    // Whatever the control for it is, it names this session.
    expect(within(form).getByText('Session "Shop"')).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Secrets for this session' }),
      ).toBeNull(),
    );
  });

  it('does not let the popover that is fading away take the keyboard from the form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveSecrets();
    const { user } = setup();
    const onFocus = vi.fn();
    screen
      .getByRole('button', { name: 'Secrets for this session' })
      .addEventListener('focus', onFocus);
    const popover = await open(user);
    onFocus.mockClear();
    await user.click(
      await within(popover).findByRole('button', { name: ADD_FOR_SHOP }),
    );
    const form = await formOf();
    // The popover hands its focus back as it goes, a moment after it closed.
    await act(() => vi.advanceTimersByTimeAsync(50));

    expect(onFocus).not.toHaveBeenCalled();
    expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });

  it('starts as the kind that is most often typed into a page, a login', async () => {
    serveSecrets();
    const { user } = setup();
    const form = await openForm(user);
    expect(
      within(form).getByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('Credentials');
    // The first field is where the keyboard is: the form is ready to type.
    expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveFocus();
  });

  it('saves the secret for this session, says so, and gives the keyboard back to the button of the popover', async () => {
    const { api: secretsApi, state } = serveSecrets();
    const { user } = setup();
    const form = await openForm(user);

    await user.type(
      within(form).getByRole('textbox', { name: 'Title' }),
      'Shop login',
    );
    await user.type(
      within(form).getByRole('textbox', { name: 'Username' }),
      'ada',
    );
    await user.click(within(form).getByRole('button', { name: 'Add secret' }));

    await noForm();
    expect(secretsApi.callsTo('POST /secrets')[0]?.body).toMatchObject({
      kind: 'credentials',
      title: 'Shop login',
      sessionId: 7,
      fields: [{ label: 'Username', value: 'ada' }],
    });
    expect(state.secrets[0]).toMatchObject({
      title: 'Shop login',
      session: { id: 7 },
    });
    // The form's own notice, in its own words: that is all this test needs of it.
    expect(openToastLines()).toEqual([
      expect.stringMatching(/^success: Secret added/),
    ]);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Secrets for this session' }),
      ).toHaveFocus(),
    );
  });

  it('lists the secret it saved when the popover is opened again', async () => {
    serveSecrets();
    const { user } = setup();
    const form = await openForm(user);
    await user.type(
      within(form).getByRole('textbox', { name: 'Title' }),
      'Shop login',
    );
    await user.type(
      within(form).getByRole('textbox', { name: 'Username' }),
      'ada',
    );
    await user.click(within(form).getByRole('button', { name: 'Add secret' }));
    await noForm();

    const again = await open(user);
    expect(await within(again).findByText('Shop login')).toBeVisible();
    // Beside the ones that were there, and not the other session's.
    expect(within(again).getByText('Example login')).toBeVisible();
    expect(within(again).queryByText('Beta only')).toBeNull();
  });

  it('closes with Escape, saves nothing, and gives the keyboard back to the button of the popover', async () => {
    const { api: secretsApi } = serveSecrets();
    const { user, onType } = setup();
    await openForm(user);

    await user.keyboard('{Escape}');

    await noForm();
    expect(secretsApi.callsTo('POST /secrets')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
    // Nothing was chosen to type.
    expect(onType).not.toHaveBeenCalled();
  });

  it('closes with Cancel, saves nothing, and gives the keyboard back to the button of the popover', async () => {
    const { api: secretsApi } = serveSecrets();
    const { user } = setup();
    const form = await openForm(user);

    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    await noForm();
    expect(secretsApi.callsTo('POST /secrets')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
  });

  it('asks before it drops what was typed, and keeps the form when the person says no', async () => {
    const { api: secretsApi } = serveSecrets();
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { user } = setup();
    const form = await openForm(user);
    await user.type(
      within(form).getByRole('textbox', { name: 'Title' }),
      'Half done',
    );

    await user.keyboard('{Escape}');
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(screen.getByRole('dialog', { name: 'Add secret' })).toBeVisible();
    expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveValue(
      'Half done',
    );

    confirm.mockReturnValue(true);
    await user.keyboard('{Escape}');
    await noForm();
    expect(secretsApi.callsTo('POST /secrets')).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
    confirm.mockRestore();
  });

  it('can be reached and left with the keyboard alone', async () => {
    serveSecrets();
    const { user } = setup();
    screen.getByRole('button', { name: 'Secrets for this session' }).focus();
    await user.keyboard('{Enter}');
    const popover = await screen.findByRole('dialog', {
      name: 'Secrets for this session',
    });
    const add = await within(popover).findByRole('button', {
      name: ADD_FOR_SHOP,
    });
    for (
      let presses = 0;
      presses < 20 && document.activeElement !== add;
      presses++
    ) {
      await user.tab();
    }
    expect(add).toHaveFocus();

    await user.keyboard('{Enter}');
    const form = await formOf();
    expect(within(form).getByRole('textbox', { name: 'Title' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await noForm();
    expect(
      screen.getByRole('button', { name: 'Secrets for this session' }),
    ).toHaveFocus();
  });

  it('speaks German', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    try {
      serveSecrets();
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', {
          name: 'Secrets für diese Sitzung',
        }),
      );
      const popover = await screen.findByRole('dialog', {
        name: 'Secrets für diese Sitzung',
      });
      await user.click(
        await within(popover).findByRole('button', {
          name: 'Secret für „Shop“ hinzufügen',
        }),
      );
      const form = await screen.findByRole('dialog', {
        name: 'Secret hinzufügen',
      });
      expect(within(form).getByText('Sitzung „Shop“')).toBeVisible();
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('speaks French', async () => {
    const { LOCALE_STORAGE_KEY } = await import('@tale/ui/i18n/detect-locale');
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    try {
      serveSecrets();
      const { user } = setup();
      await user.click(
        await screen.findByRole('button', {
          name: 'Secrets pour cette session',
        }),
      );
      const popover = await screen.findByRole('dialog', {
        name: 'Secrets pour cette session',
      });
      await user.click(
        await within(popover).findByRole('button', {
          name: 'Ajouter un secret pour «\u00a0Shop\u00a0»',
        }),
      );
      const form = await screen.findByRole('dialog', {
        name: 'Ajouter un secret',
      });
      expect(within(form).getByText('Session « Shop »')).toBeVisible();
    } finally {
      localStorage.removeItem(LOCALE_STORAGE_KEY);
    }
  });

  it('has no accessibility violations with the form open over the page', async () => {
    serveSecrets();
    const { user } = setup();
    await openForm(user);
    await checkAccessibility(document.body);
  });

  it('has no accessibility violations in the popover that offers it', async () => {
    serveSecrets();
    const { user } = setup();
    const popover = await open(user);
    await within(popover).findByRole('button', { name: ADD_FOR_SHOP });
    await checkAccessibility(document.body);
  });
});
