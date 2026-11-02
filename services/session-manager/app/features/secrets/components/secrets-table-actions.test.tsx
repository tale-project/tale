import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure } from '@/tests/utils/fake-api';
import { renderApp } from '@/tests/utils/render';
import { installSecretsApi, SAMPLE } from '@/tests/utils/secrets-api';
import {
  chooseFilter,
  HeldSecretsTable,
} from '@/tests/utils/secrets-held-table';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/secrets');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T10:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

async function renderTable(
  options: Parameters<typeof installSecretsApi>[0] = {},
) {
  const backend = installSecretsApi(options);
  const view = renderApp(
    <>
      <HeldSecretsTable />
      <ToastProbe />
    </>,
  );
  await screen.findByRole('table', { name: 'Secrets' });
  // The list has been read, whatever it holds (rows, nothing, or a failure).
  await waitFor(() =>
    expect(screen.queryByRole('status', { busy: true })).toBeNull(),
  );
  return { ...view, ...backend };
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByRole('button', { name: title }).closest('tr');
  if (row === null) throw new Error(`No row for ${title}`);
  return row;
}

function titles(): string[] {
  const table = screen.getByRole('table', { name: 'Secrets' });
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0]?.textContent ?? '');
}

const menu = (title: string) =>
  screen.getByRole('button', { name: `Actions for ${title}` });

/**
 * Escape closes the topmost layer. In jsdom the tooltip of the menu button,
 * which the menu focuses on its way out, can still be up over the dialog it
 * opened and takes the first Escape; a browser leaves none (checked in
 * Chromium). A second Escape then closes the dialog.
 */
async function escapeOut(user: UserEvent) {
  await user.keyboard('{Escape}');
  if (screen.queryByRole('dialog') !== null) await user.keyboard('{Escape}');
}

/** The checks of a page with the menu's tooltip drawn outside any landmark, as a component test has none around the page. */
const WITHOUT_LANDMARK_RULE = { rules: { region: { enabled: false } } };

describe('opening a secret from the list', () => {
  it('reads it from the button that leads its row', async () => {
    const { user, api } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Example shop' }));

    expect(
      await screen.findByRole('dialog', { name: 'Secret details' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Username')).toBeInTheDocument();
    expect(api.callsTo('GET /secrets/:id')[0]?.params.id).toBe('6');
  });

  it('reads it from a click anywhere in its row, for a pointer', async () => {
    const { user } = await renderTable();
    await user.click(within(rowOf('Example shop')).getByText('Credentials'));
    expect(
      await screen.findByRole('dialog', { name: 'Secret details' }),
    ).toBeInTheDocument();
  });

  it('opens nothing from the link to a session: the link goes to the session', async () => {
    const { user } = await renderTable();
    await user.click(
      within(rowOf('Visa ending 4242')).getByRole('link', { name: '0003' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the menu of a row without reading the secret', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Secret details' }),
    ).not.toBeInTheDocument();
  });

  it('reads it from the menu too', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'View' }));
    expect(
      await screen.findByRole('dialog', { name: 'Secret details' }),
    ).toBeInTheDocument();
  });

  it('gives the focus back to the button of the row when the read dialog closes', async () => {
    const { user } = await renderTable();
    const lead = screen.getByRole('button', { name: 'Example shop' });
    lead.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Secret details' });
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(lead).toHaveFocus();
  });

  it('gives the focus back to the menu button when a dialog opened from the menu closes', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'View' }));
    await screen.findByRole('dialog', { name: 'Secret details' });
    await escapeOut(user);

    await waitFor(() => expect(menu('Example shop')).toHaveFocus());
  });

  it('brings the details back and then still returns the focus to where the person came from', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'View' }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('dialog', { name: 'Secret details' });
    await escapeOut(user);

    await waitFor(() => expect(menu('Example shop')).toHaveFocus());
  });

  it('does the same from the button that leads the row', async () => {
    const { user } = await renderTable();
    const lead = screen.getByRole('button', { name: 'Example shop' });
    lead.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('dialog', { name: 'Secret details' });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(lead).toHaveFocus());
  });
});

describe('changing a secret from the list', () => {
  it('opens its form with the whole secret and shows the saved change in the list', async () => {
    const { user, api } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    const title = await screen.findByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('Example shop');
    expect(screen.getByLabelText('Password')).toHaveValue(
      'correct horse battery staple',
    );
    await user.clear(title);
    await user.type(title, 'Example store');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('PATCH /secrets/:id')[0]?.body).toEqual({
      title: 'Example store',
    });
    expect(
      await screen.findByRole('button', { name: 'Example store' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Example shop' }),
    ).not.toBeInTheDocument();
    expect(openToastLines()).toEqual(['success: Secret updated']);
  });

  it('moves a secret to every session and shows it so', async () => {
    const { user } = await renderTable();
    await user.click(menu('Mail'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await user.click(
      await screen.findByRole('button', { name: 'Available to' }),
    );
    await user.click(
      await screen.findByRole('option', { name: 'Every session' }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(within(rowOf('Mail')).queryByRole('link')).not.toBeInTheDocument(),
    );
    expect(
      within(rowOf('Mail')).getByText('Every session'),
    ).toBeInTheDocument();
  });

  it('leaves the list as it was when the edit is cancelled', async () => {
    const { user, api } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(0);
    expect(titles()).toHaveLength(6);
  });

  it('gives the focus back to the menu button, whether the form is cancelled or saved', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(menu('Example shop')).toHaveFocus());

    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(title, '!');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(menu('Example shop!')).toHaveFocus());
  });
});

describe('deleting a secret from the list', () => {
  it('asks, naming the secret, and removes the row once it is deleted', async () => {
    const { user, api } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(
      await screen.findByRole('dialog', { name: 'Delete "Example shop"?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete secret' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Example shop' }),
      ).not.toBeInTheDocument(),
    );
    expect(api.callsTo('DELETE /secrets/:id')[0]?.params.id).toBe('6');
    expect(titles()).toEqual([
      'Wi-Fi at the office',
      'Visa ending 4242',
      'My details',
      'Bank',
      'Mail',
    ]);
    expect(screen.getByText('Showing all 5 secrets')).toBeInTheDocument();
    expect(openToastLines()).toEqual(['success: Secret deleted']);
  });

  it('keeps the row when the person says no', async () => {
    const { user, api } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('DELETE /secrets/:id')).toHaveLength(0);
    expect(titles()).toHaveLength(6);
    await waitFor(() => expect(menu('Example shop')).toHaveFocus());
  });

  it('puts the focus on the menu of the next row when the row the person worked on is gone', async () => {
    const { user } = await renderTable();
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(
      await screen.findByRole('button', { name: 'Delete secret' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Example shop' }),
      ).not.toBeInTheDocument(),
    );

    await waitFor(() => expect(menu('My details')).toHaveFocus());
  });

  it('puts the focus on the Add button when the last secret is deleted', async () => {
    const { user } = await renderTable({ secrets: [SAMPLE.credentials] });
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(
      await screen.findByRole('button', { name: 'Delete secret' }),
    );

    await screen.findByRole('heading', { name: 'No secrets yet' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add secret' })).toHaveFocus(),
    );
  });

  it('says a failure once and keeps the row', async () => {
    const { user, api } = await renderTable();
    api.on('DELETE /secrets/:id', failure(500, 'internal', 'boom'));
    await user.click(menu('Example shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(
      await screen.findByRole('button', { name: 'Delete secret' }),
    );

    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't delete the secret",
      ]),
    );
    // The question stays open, so the person can try again or leave.
    expect(
      screen.getByRole('dialog', { name: 'Delete "Example shop"?' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(titles()).toHaveLength(6);
  });
});

describe('adding a secret from the list', () => {
  it('opens the form, for a credential for every session unless the list is narrowed', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Add secret' }));

    expect(
      await screen.findByRole('dialog', { name: 'Add secret' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('Credentials');
    expect(
      screen.getByRole('button', { name: 'Available to' }),
    ).toHaveTextContent('Every session');
  });

  it('starts as the kind and for the session the list is narrowed to', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Credit card');
    await chooseFilter(user, 'Available to', 'Session "0003"');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Add secret' }));

    expect(
      await screen.findByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('Credit card');
    expect(
      await screen.findByRole('button', { name: /^Available to/ }),
    ).toHaveTextContent('Session "0003"');
  });

  it('starts for every session when the list shows all secrets', async () => {
    const { user } = await renderTable();
    await chooseFilter(user, 'Type', 'Note');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add secret' }));
    expect(
      await screen.findByRole('combobox', { name: 'Type' }),
    ).toHaveTextContent('Note');
    expect(
      screen.getByRole('button', { name: /^Available to/ }),
    ).toHaveTextContent('Every session');
  });

  it('shows the new secret at the top of the list, and says it is added', async () => {
    const { user, api } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Add secret' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'Title' }),
      'New shop',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Website' }),
      'new.example.com',
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Add secret',
        }),
      ).toBeEnabled(),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Add secret',
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('POST /secrets')).toHaveLength(1);
    await waitFor(() => expect(titles()[0]).toBe('New shop'));
    expect(titles()).toHaveLength(7);
    expect(openToastLines()).toEqual(['success: Secret added']);
  });

  it('gives the focus back to the Add button when the form is cancelled', async () => {
    const { user } = await renderTable();
    const add = screen.getByRole('button', { name: 'Add secret' });
    await user.click(add);
    await screen.findByRole('textbox', { name: 'Title' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(add).toHaveFocus();
  });

  it('cannot add before the kinds are known', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /meta', () => new Promise(() => {}));
    renderApp(<HeldSecretsTable />);
    await screen.findByRole('button', { name: 'Example shop' });
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeDisabled();
  });

  it('adds the first secret from the empty list', async () => {
    const { user } = await renderTable({ secrets: [] });
    await user.click(await screen.findByRole('button', { name: 'Add secret' }));
    expect(
      await screen.findByRole('dialog', { name: 'Add secret' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add secret' })).toHaveFocus(),
    );
  });
});

describe('the keyboard in the list', () => {
  it('reaches the search, the filters, Add and then each row in turn', async () => {
    const { user } = await renderTable();
    await user.tab();
    expect(
      screen.getByRole('textbox', { name: 'Search secrets' }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add secret' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Wi-Fi at the office' }),
    ).toHaveFocus();
    await user.tab();
    expect(menu('Wi-Fi at the office')).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('button', { name: 'Visa ending 4242' }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(rowOf('Visa ending 4242')).getByRole('link', { name: '0003' }),
    ).toHaveFocus();
  });

  it('opens a secret and its menu with Enter and Space', async () => {
    const { user } = await renderTable();
    menu('Mail').focus();
    await user.keyboard(' ');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(
      await screen.findByRole('dialog', { name: 'Delete "Mail"?' }),
    ).toBeInTheDocument();
  });
});

describe('the list with a dialog open', () => {
  it('has no accessibility violations while the read dialog, the form and the question are open', async () => {
    const { user } = await renderTable();
    await user.click(screen.getByRole('button', { name: 'Visa ending 4242' }));
    await screen.findByText('Card number');
    await checkAccessibility(document.body, WITHOUT_LANDMARK_RULE);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    await user.click(menu('Visa ending 4242'));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    await screen.findByLabelText('Card number');
    await checkAccessibility(document.body, WITHOUT_LANDMARK_RULE);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    await user.click(menu('Visa ending 4242'));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Delete "Visa ending 4242"?' });
    await checkAccessibility(document.body, WITHOUT_LANDMARK_RULE);
  });
});
