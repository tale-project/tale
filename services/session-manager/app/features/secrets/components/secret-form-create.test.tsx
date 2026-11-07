import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { secretCreateSchema, type SecretKind } from '@/lib/api/schemas';
import { i18n } from '@/lib/i18n/i18n';
import { MAX_LABEL, MAX_TITLE, MAX_VALUE } from '@/lib/secret-limits';
import errors from '@/messages/en/errors.yml';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  failure,
  installFakeApi,
  type FakeRoute,
} from '@/tests/utils/fake-api';
import { meta, secret } from '@/tests/utils/fixtures';
import { countWrites, heldByWrites } from '@/tests/utils/mutation-cache';
import { renderApp } from '@/tests/utils/render';
import { installSecretsApi } from '@/tests/utils/secrets-api';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

import { SecretFormDialog } from './secret-form-dialog';

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

interface CreateOptions {
  kind?: SecretKind;
  scope?: string;
  /** The session the scope names, when the form is opened for one. */
  session?: { id: number; name: string };
  /** The title field's name, which the form is ready by: it is not English in German. */
  ready?: string;
}

/** The form to add a secret, as the page opens it, once the kinds are known. */
async function renderCreate({
  kind = 'credentials',
  scope = 'global',
  session,
  ready = 'Title',
}: CreateOptions = {}) {
  const backend = installSecretsApi();
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = renderApp(
    <>
      <SecretFormDialog
        target={{ type: 'create', kind, scope, session }}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />
      <ToastProbe />
    </>,
  );
  await screen.findByRole('textbox', { name: ready });
  return { ...view, ...backend, onOpenChange, onSaved };
}

const title = () => screen.getByRole('textbox', { name: 'Title' });
const save = () => screen.getByRole('button', { name: 'Add secret' });
/** A value's field by its label: a hidden value is a password field, which has no role of a text field. */
const field = (name: string) => screen.getByLabelText(name);
/** The button of the list of sessions: named by its label, it shows who it is for. */
const scope = () => screen.getByRole('button', { name: 'Available to' });

async function chooseKind(
  user: Awaited<ReturnType<typeof renderCreate>>['user'],
  name: string,
) {
  await user.click(screen.getByRole('combobox', { name: 'Type' }));
  await user.click(await screen.findByRole('option', { name }));
}

const createBody = (api: Awaited<ReturnType<typeof renderCreate>>['api']) =>
  api.callsTo('POST /secrets')[0]?.body;

describe('the form to add a secret', () => {
  it.each([
    [
      'personal',
      ['Name', 'Email', 'Phone', 'Address', 'Company', 'Company address'],
    ],
    ['credentials', ['Website', 'Username', 'Password']],
    ['card', ['Cardholder', 'Card number', 'Expiration date', 'CVC']],
    ['note', ['Note']],
  ] as const)(
    'starts a %s with the fields of its kind',
    async (kind, labels) => {
      await renderCreate({ kind });
      const group = screen.getByRole('group', { name: 'Values' });
      // One value each, in the order they are read.
      const fields = labels.map((label) => within(group).getByLabelText(label));
      fields.slice(1).forEach((next, index) => {
        expect(
          fields[index].compareDocumentPosition(next) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      });
      // Whether a value is hidden is not asked: the kind and the label say it.
      expect(within(group).queryByRole('checkbox')).not.toBeInTheDocument();
    },
  );

  it('is titled for adding, with the kind to choose first and nothing said about it the fields do not show', async () => {
    await renderCreate();
    expect(
      screen.getByRole('dialog', { name: 'Add secret' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
      'Credentials',
    );
    expect(
      screen.queryByText('A website with its username and password.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['personal', 'e.g. My details'],
    ['credentials', 'e.g. Shop login'],
    ['card', 'e.g. Visa ending 4242'],
    ['note', 'e.g. Recovery codes'],
  ] as const)('suggests a title for a %s', async (kind, example) => {
    await renderCreate({ kind });
    expect(title()).toHaveAttribute('placeholder', example);
  });

  it('masks the values a kind hides: the password, the card number and the CVC', async () => {
    const shows = () =>
      screen
        .queryAllByRole('button', { name: /^Show / })
        .map((button) => button.getAttribute('aria-label'));
    const { unmount } = await renderCreate({ kind: 'credentials' });
    expect(shows()).toEqual(['Show Password']);
    expect(field('Password')).toHaveAttribute('type', 'password');
    expect(field('Username')).toHaveAttribute('type', 'text');
    unmount();

    await renderCreate({ kind: 'card' });
    expect(shows()).toEqual(['Show Card number', 'Show CVC']);
  });

  it('draws every value on one edge: the button of a hidden value sits inside its field, and a new value has no copy', async () => {
    await renderCreate({ kind: 'credentials' });
    const password = field('Password');
    expect(password.parentElement).toContainElement(
      screen.getByRole('button', { name: 'Show Password' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Copy Password' }),
    ).not.toBeInTheDocument();
  });

  it('gives the fields a kind marks multiline a text area', async () => {
    await renderCreate({ kind: 'personal' });
    expect(field('Address').tagName).toBe('TEXTAREA');
    expect(field('Company address').tagName).toBe('TEXTAREA');
    expect(field('Name').tagName).toBe('INPUT');
  });

  it('is one text for a note, with nothing to add', async () => {
    await renderCreate({ kind: 'note' });
    expect(field('Note').tagName).toBe('TEXTAREA');
    expect(
      screen.queryByRole('button', { name: 'Add field' }),
    ).not.toBeInTheDocument();
  });

  it('is for every session, or for the session the list is narrowed to', async () => {
    const { unmount } = await renderCreate({ scope: 'global' });
    expect(scope()).toHaveTextContent('Every session');
    unmount();

    await renderCreate({ scope: '12' });
    await waitFor(() => expect(scope()).toHaveTextContent('Session "Shop EU"'));
  });

  it('names the session it is opened for, which the sessions it lists may not hold', async () => {
    // Session 900 is not among the newest 500 the select lists: its number
    // would stand where its name should.
    await renderCreate({
      scope: '900',
      session: { id: 900, name: 'Old shop' },
    });
    await waitFor(() =>
      expect(scope()).toHaveTextContent('Session "Old shop"'),
    );
  });

  it('shows the number of a session it is opened for without knowing its name', async () => {
    await renderCreate({ scope: '900' });
    await waitFor(() => expect(scope()).toHaveTextContent('Session "900"'));
  });

  it('waits for something to be typed before it can be saved, and says nothing is wrong before then', async () => {
    const { user } = await renderCreate();
    expect(save()).toBeDisabled();
    // Nothing was done: nothing is wrong yet.
    expect(
      screen.queryByText('Enter at least one value.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Enter a title.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.type(title(), 'Shop');
    expect(save()).toBeEnabled();
  });

  it('tells what is missing once the button is pressed: the value beside the values, with the cursor in the first', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'Shop');
    await user.click(save());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter at least one value.');
    expect(field('Website')).toHaveFocus();
    expect(api.callsTo('POST /secrets')).toHaveLength(0);

    // It goes the moment a value is typed.
    await user.type(field('Website'), 'example.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(api.callsTo('POST /secrets')).toHaveLength(1));
  });

  it('tells a missing title beside the title, with the cursor in it, and takes it back when it is typed', async () => {
    const { user, api } = await renderCreate();
    await user.type(field('Website'), 'example.com');
    await user.click(save());

    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(title()).toHaveAccessibleDescription('Enter a title.');
    expect(title()).toHaveAttribute('aria-invalid', 'true');
    expect(title()).toHaveFocus();
    expect(api.callsTo('POST /secrets')).toHaveLength(0);

    await user.type(title(), 'Shop');
    expect(screen.queryByText('Enter a title.')).not.toBeInTheDocument();
  });

  it('starts the messages over when the kind is changed: nothing is said of the new fields until the button is pressed again', async () => {
    const { user } = await renderCreate();
    await user.type(field('Website'), 'x');
    await user.click(save());
    await screen.findByText('Enter a title.');

    await chooseKind(user, 'Note');
    expect(screen.queryByText('Enter a title.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(save());
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
  });

  it('does not tell a missing title when the title was left for the list of sessions', async () => {
    const { user } = await renderCreate();
    await user.type(field('Website'), 'x');
    await user.click(title());
    await user.click(scope());
    await screen.findByRole('option', { name: 'Session "0003"' });
    expect(screen.queryByText('Enter a title.')).not.toBeInTheDocument();
  });

  it('needs no words about hidden values: the masked fields show which they are', async () => {
    await renderCreate();
    expect(screen.getByRole('group', { name: 'Values' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});

describe('adding a secret', () => {
  it('sends the title trimmed, the values typed and the flags, then says it is added and closes', async () => {
    const { user, api, state, onOpenChange, onSaved } = await renderCreate();

    await user.type(title(), '  Example shop ');
    await user.type(field('Website'), 'shop.example.com');
    await user.type(field('Password'), ' pa ss ');
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createBody(api)).toEqual({
      kind: 'credentials',
      title: 'Example shop',
      sessionId: null,
      fields: [
        { label: 'Website', value: 'shop.example.com' },
        { label: 'Password', value: ' pa ss ', hidden: true },
      ],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(openToastLines()).toEqual(['success: Secret added']);
    expect(state.secrets[0]).toMatchObject({
      title: 'Example shop',
      kind: 'credentials',
    });
  });

  it('drops the rows left empty, with their labels', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.type(field('Username'), 'ada');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [{ label: 'Username', value: 'ada' }],
    });
  });

  it('sends a personal secret with an address of several lines', async () => {
    const { user, api } = await renderCreate({ kind: 'personal' });
    await user.type(title(), 'Me');
    await user.type(field('Name'), 'Ada');
    await user.type(field('Address'), 'Street 1{Enter}10117 Berlin');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      kind: 'personal',
      fields: [
        { label: 'Name', value: 'Ada' },
        { label: 'Address', value: 'Street 1\n10117 Berlin' },
      ],
    });
  });

  it('sends a card with its number and its CVC hidden', async () => {
    const { user, api } = await renderCreate({ kind: 'card' });
    await user.type(title(), 'Visa');
    await user.type(field('Cardholder'), 'Ada');
    await user.type(field('Card number'), '4242 4242 4242 4242');
    await user.type(field('CVC'), '123');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      kind: 'card',
      fields: [
        { label: 'Cardholder', value: 'Ada' },
        { label: 'Card number', value: '4242 4242 4242 4242', hidden: true },
        { label: 'CVC', value: '123', hidden: true },
      ],
    });
  });

  it('sends a note', async () => {
    const { user, api } = await renderCreate({ kind: 'note' });
    await user.type(title(), 'Wi-Fi');
    await user.type(field('Note'), 'line 1{Enter}line 2');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      kind: 'note',
      fields: [{ label: 'Note', value: 'line 1\nline 2' }],
    });
  });

  it('is for the session that is chosen', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.type(field('Website'), 'x');
    await user.click(scope());
    await user.click(
      await screen.findByRole('option', { name: 'Session "0003"' }),
    );
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({ sessionId: 3 });
  });

  it('is for the session the list was narrowed to, unless another is chosen', async () => {
    const { user, api } = await renderCreate({ scope: '12' });
    await user.type(title(), 'T');
    await user.type(field('Website'), 'x');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({ sessionId: 12 });
  });
});

describe('choosing the kind of a new secret', () => {
  it('swaps the fields for those of the other kind, and the example title with them', async () => {
    const { user } = await renderCreate();
    await chooseKind(user, 'Credit card');

    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveTextContent(
      'Credit card',
    );
    expect(field('Card number')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Website' }),
    ).not.toBeInTheDocument();
    expect(title()).toHaveAttribute('placeholder', 'e.g. Visa ending 4242');
  });

  it('is no edit: closing right after asks nothing', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm');
    const { user, onOpenChange } = await renderCreate();
    await chooseKind(user, 'Note');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps a value that was typed: it goes to the field of the same name, or stays as a field of its own', async () => {
    const { user, api } = await renderCreate({ kind: 'personal' });
    await user.type(title(), 'Mixed');
    await user.type(field('Name'), 'Ada');
    await user.type(field('Address'), 'Street 1');

    await chooseKind(user, 'Credit card');

    // "Name" has no field in a card: it stays, as a field of its own, with the label as it was shown.
    const group = screen.getByRole('group', { name: 'Name' });
    expect(within(group).getByRole('textbox', { name: 'Value' })).toHaveValue(
      'Ada',
    );
    expect(within(group).getByRole('textbox', { name: 'Label' })).toHaveValue(
      'Name',
    );
    await user.type(field('Cardholder'), 'Ada L.');
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      kind: 'card',
      fields: expect.arrayContaining([
        { label: 'Cardholder', value: 'Ada L.' },
        { label: 'Name', value: 'Ada' },
        { label: 'Address', value: 'Street 1' },
      ]),
    });
  });

  it('keeps a typed label of a field that was added', async () => {
    const { user } = await renderCreate();
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Door');
    await user.type(screen.getByRole('textbox', { name: 'Value' }), '4821');

    await chooseKind(user, 'Credit card');

    const group = screen.getByRole('group', { name: 'Door' });
    expect(within(group).getByRole('textbox', { name: 'Value' })).toHaveValue(
      '4821',
    );
  });

  it('keeps a hidden value hidden when it becomes a field of its own', async () => {
    const { user, api } = await renderCreate({ kind: 'card' });
    await user.type(title(), 'T');
    await user.type(field('CVC'), '123');

    await chooseKind(user, 'Note');

    const group = screen.getByRole('group', { name: 'CVC' });
    expect(within(group).getByLabelText('Value')).toHaveAttribute(
      'type',
      'password',
    );
    await user.click(save());
    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [{ label: 'CVC', value: '123', hidden: true }],
    });
  });

  it('is asked about when closing, once something was typed', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { user } = await renderCreate();
    await user.type(field('Website'), 'x');
    await chooseKind(user, 'Note');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalled();
  });
});

describe('adding fields to a new secret', () => {
  it('adds a field with a label to type and a value, and puts the cursor in its label', async () => {
    const { user } = await renderCreate();
    await user.click(screen.getByRole('button', { name: 'Add field' }));

    const group = screen.getByRole('group', { name: 'Field 1' });
    expect(within(group).getByRole('textbox', { name: 'Label' })).toHaveFocus();
    expect(
      within(group).getByRole('textbox', { name: 'Value' }),
    ).toBeInTheDocument();
  });

  it('sends the added fields, in the order added, after those of the kind', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.type(field('Website'), 'x');
    for (const [label, value] of [
      ['Security answer', 'Rex'],
      ['Backup code', '1234'],
    ]) {
      await user.click(screen.getByRole('button', { name: 'Add field' }));
      const labels = screen.getAllByRole('textbox', { name: 'Label' });
      const values = screen.getAllByRole('textbox', { name: 'Value' });
      await user.type(labels[labels.length - 1], label);
      await user.type(values[values.length - 1], value);
    }
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [
        { label: 'Website', value: 'x' },
        { label: 'Security answer', value: 'Rex' },
        { label: 'Backup code', value: '1234' },
      ],
    });
  });

  it('hides an added field whose label names something private, masked as it is typed', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    const group = screen.getByRole('group', { name: 'PIN' });
    const value = within(group).getByLabelText('Value');
    expect(value).toHaveAttribute('type', 'password');
    await user.type(value, '4821');

    await user.click(save());
    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [{ label: 'PIN', value: '4821', hidden: true }],
    });
  });

  it('leaves the flag of any other added field to the server, which hides what looks like a card number', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Number');
    await user.type(
      screen.getByRole('textbox', { name: 'Value' }),
      '4242 4242 4242 4242',
    );
    await user.click(save());

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(secretCreateSchema.parse(createBody(api)).fields).toEqual([
      { label: 'Number', value: '4242 4242 4242 4242' },
    ]);
  });

  it('removes an added field with its label and value, and puts the cursor on Add field', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.type(field('Website'), 'x');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Temp');
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'gone');

    await user.click(screen.getByRole('button', { name: 'Remove Temp' }));

    expect(
      screen.queryByRole('group', { name: 'Temp' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add field' })).toHaveFocus();
    await user.click(save());
    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [{ label: 'Website', value: 'x' }],
    });
  });

  it('names an added field with no label by its place, and renames it as the label is typed', async () => {
    const { user } = await renderCreate();
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByRole('group', { name: 'Field 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Field 2' })).toBeInTheDocument();

    const labels = screen.getAllByRole('textbox', { name: 'Label' });
    await user.type(labels[0], 'Alpha');
    expect(screen.getByRole('group', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Field 2' })).toBeInTheDocument();
  });
});

describe('what a secret may hold', () => {
  it('refuses a title that is too long, beside the title, and sends nothing', async () => {
    const { user, api } = await renderCreate();
    await user.click(title());
    await user.paste('a'.repeat(MAX_TITLE + 1));
    await user.type(field('Website'), 'x');
    // Leaving the field says nothing: the button does.
    await user.tab();
    expect(
      screen.queryByText(
        `Shorten the title to ${MAX_TITLE} characters or fewer.`,
      ),
    ).not.toBeInTheDocument();
    await user.click(save());

    expect(
      await screen.findByText(
        `Shorten the title to ${MAX_TITLE} characters or fewer.`,
      ),
    ).toBeInTheDocument();
    expect(title()).toHaveAccessibleDescription(
      `Shorten the title to ${MAX_TITLE} characters or fewer.`,
    );
    expect(api.callsTo('POST /secrets')).toHaveLength(0);
  });

  it('accepts a title of the longest length', async () => {
    const { user, api } = await renderCreate();
    await user.click(title());
    await user.paste('a'.repeat(MAX_TITLE));
    await user.type(field('Website'), 'x');
    await user.click(save());
    await waitFor(() => expect(api.callsTo('POST /secrets')).toHaveLength(1));
  });

  it('counts a title as a person counts it: an emoji is one character', async () => {
    const { user, api } = await renderCreate();
    await user.click(title());
    await user.paste('😀'.repeat(MAX_TITLE));
    await user.type(field('Website'), 'x');
    await user.click(save());
    await waitFor(() => expect(api.callsTo('POST /secrets')).toHaveLength(1));
  });

  it('wants a label for a value that has none, beside the label', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Value' }),
      'secret value',
    );
    await user.click(save());

    const message = 'Enter a label for this value (e.g. Username).';
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Label' }),
    ).toHaveAccessibleDescription(message);
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    expect(api.callsTo('POST /secrets')).toHaveLength(0);

    // Typing the label takes the message away.
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it('refuses a label that is too long', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.click(screen.getByRole('textbox', { name: 'Label' }));
    await user.paste('l'.repeat(MAX_LABEL + 1));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'v');
    await user.click(save());

    expect(
      await screen.findByText(
        `Shorten the label to ${MAX_LABEL} characters or fewer.`,
      ),
    ).toBeInTheDocument();
    expect(api.callsTo('POST /secrets')).toHaveLength(0);
  });

  it('refuses a value that is too long, naming its field, with the limit as the person reads numbers', async () => {
    const { user, api } = await renderCreate({ kind: 'note' });
    await user.type(title(), 'T');
    fireEvent.change(field('Note'), {
      target: { value: 'n'.repeat(MAX_VALUE + 1) },
    });
    await user.click(save());

    expect(
      await screen.findByText('Shorten "Note" to 20,000 characters or fewer.'),
    ).toBeInTheDocument();
    expect(field('Note')).toHaveFocus();
    expect(api.callsTo('POST /secrets')).toHaveLength(0);
  });

  it('does not check a field that has a label but no value', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'T');
    await user.type(field('Website'), 'x');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.click(screen.getByRole('textbox', { name: 'Label' }));
    await user.paste('l'.repeat(MAX_LABEL + 10));
    await user.click(save());

    await waitFor(() => expect(api.callsTo('POST /secrets')).toHaveLength(1));
    expect(
      screen.queryByText(/A label can have at most/),
    ).not.toBeInTheDocument();
  });

  it('tells every problem at once, and starts with the first', async () => {
    const { user } = await renderCreate();
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'v');
    await user.type(field('Website'), 'x');
    await user.click(save());

    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a label for this value (e.g. Username).'),
    ).toBeInTheDocument();
    expect(title()).toHaveFocus();
  });

  it('tells a value of only blanks is no value', async () => {
    const { user } = await renderCreate();
    await user.type(title(), 'Blanks');
    await user.type(field('Website'), '   ');
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter at least one value.',
    );
  });
});

describe('when the server refuses or fails', () => {
  async function fill(user: Awaited<ReturnType<typeof renderCreate>>['user']) {
    await user.type(title(), 'Shop');
    await user.type(field('Website'), 'x');
  }

  it('shows a refusal of the values on top of the form, keeps the draft and raises no toast', async () => {
    const { user, api, onOpenChange } = await renderCreate();
    api.on(
      'POST /secrets',
      failure(422, 'invalid_secret', 'Enter at least one value.'),
    );
    await fill(user);

    await user.click(save());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Check the values of this secret.');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title()).toHaveValue('Shop');
    expect(field('Website')).toHaveValue('x');
    expect(openToastLines()).toEqual([]);
  });

  it('words a validation error of the request the same way', async () => {
    const { user, api } = await renderCreate();
    api.on('POST /secrets', failure(422, 'validation_error', 'x'));
    await fill(user);
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the values and try again.',
    );
  });

  it('says a session that is gone, in the form, not as a toast', async () => {
    const { user, api } = await renderCreate({ scope: '12' });
    api.on('POST /secrets', failure(404, 'session_not_found', 'x'));
    await fill(user);
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This session no longer exists.',
    );
    expect(openToastLines()).toEqual([]);
  });

  it('takes the refusal away when the person tries again', async () => {
    const { user, api, onOpenChange } = await renderCreate();
    api.on('POST /secrets', failure(422, 'invalid_secret', 'x'));
    await fill(user);
    await user.click(save());
    await screen.findByRole('alert');

    api.on('POST /secrets', secret({ id: 99 }));
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(
      screen.queryByText('Check the values of this secret.'),
    ).not.toBeInTheDocument();
  });

  it('raises one toast for any other failure and keeps the form as it is', async () => {
    const { user, api, onOpenChange } = await renderCreate();
    api.on('POST /secrets', failure(500, 'internal', 'boom'));
    await fill(user);

    await user.click(save());

    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't add the secret",
      ]),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title()).toHaveValue('Shop');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the server cannot be reached, as a toast', async () => {
    const { user, api } = await renderCreate();
    api.on('POST /secrets', () => {
      throw new TypeError('Failed to fetch');
    });
    await fill(user);
    await user.click(save());
    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't add the secret",
      ]),
    );
  });

  it('shows the save under way, and cannot be saved or left meanwhile', async () => {
    const { user, api, onOpenChange } = await renderCreate();
    let finish: (value: FakeRoute) => void = () => {};
    api.on(
      'POST /secrets',
      () =>
        new Promise<FakeRoute>((resolve) => {
          finish = resolve;
        }),
    );
    await fill(user);

    await user.click(save());

    await waitFor(() => expect(save()).toHaveAttribute('aria-busy', 'true'));
    expect(save()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(api.callsTo('POST /secrets')).toHaveLength(1);

    finish(secret({ id: 1 }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('what the form leaves in the memory of the page', () => {
  // The mutation cache would keep what the form sent, hidden values included,
  // for five minutes after the form is gone.
  it('keeps none of the values once the secret is saved, with the form still on screen or gone', async () => {
    const { user, queryClient, unmount, onOpenChange } = await renderCreate();
    await user.type(title(), 'Shop');
    await user.type(field('Password'), 'PROBE-VALUE-1');

    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-VALUE-1');
    unmount();
    expect(countWrites(queryClient)).toBe(0);
  });

  it('keeps none of them either when the server refused the secret, and the draft stays for another try', async () => {
    const { user, api, queryClient, unmount } = await renderCreate();
    api.on('POST /secrets', failure(422, 'invalid_secret', 'Enter a value.'));
    await user.type(title(), 'Shop');
    await user.type(field('Password'), 'PROBE-VALUE-2');

    await user.click(save());

    await screen.findByRole('alert');
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-VALUE-2');
    expect(field('Password')).toHaveValue('PROBE-VALUE-2');
    unmount();
    expect(countWrites(queryClient)).toBe(0);
  });

  it('keeps none of them when the save failed in any other way', async () => {
    const { user, api, queryClient } = await renderCreate();
    api.on('POST /secrets', failure(500, 'internal', 'boom'));
    await user.type(title(), 'Shop');
    await user.type(field('Password'), 'PROBE-VALUE-3');

    await user.click(save());

    await waitFor(() => expect(openToastLines()).toHaveLength(1));
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-VALUE-3');
  });
});

describe('leaving the form to add a secret', () => {
  it('closes without asking when nothing was typed', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm');
    const { user, onOpenChange } = await renderCreate();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('asks before it throws away what was typed, and stays when the person says no', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
    const { user, onOpenChange } = await renderCreate();
    await user.type(title(), 'Shop');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title()).toHaveValue('Shop');
  });

  it('closes when the person says yes', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    const { user, onOpenChange } = await renderCreate();
    await user.type(field('Password'), 'x');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not count blanks or an empty added field as something typed', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm');
    const { user, onOpenChange } = await renderCreate();
    await user.type(title(), '   ');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('the keyboard in the form to add a secret', () => {
  it('starts in the title and saves with Enter', async () => {
    const { user, api, onOpenChange } = await renderCreate();
    expect(title()).toHaveFocus();
    await user.type(title(), 'Shop');
    await user.type(field('Website'), 'x');

    await user.keyboard('{Enter}');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('POST /secrets')).toHaveLength(1);
  });

  it('does not save with Enter while the form cannot be saved: it tells what is missing instead', async () => {
    const { user, api } = await renderCreate();
    await user.type(title(), 'Shop{Enter}');
    expect(api.callsTo('POST /secrets')).toHaveLength(0);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter at least one value.',
    );
  });

  it('keeps Enter in a text area for a new line', async () => {
    const { user, api } = await renderCreate({ kind: 'note' });
    await user.type(title(), 'T');
    await user.type(field('Note'), 'a{Enter}b');
    expect(field('Note')).toHaveValue('a\nb');
    expect(api.callsTo('POST /secrets')).toHaveLength(0);
  });

  it('moves through the fields in reading order: each value, and the button that shows a hidden one', async () => {
    const { user } = await renderCreate();
    expect(title()).toHaveFocus();
    await user.tab();
    expect(scope()).toHaveFocus();
    await user.tab();
    expect(field('Website')).toHaveFocus();
    await user.tab();
    expect(field('Username')).toHaveFocus();
    await user.tab();
    expect(field('Password')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Show Password' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add field' })).toHaveFocus();
  });
});

describe('the form to add a secret while the kinds are still on their way', () => {
  it('says it is loading, and cannot be saved', async () => {
    installFakeApi({ 'GET /meta': () => new Promise(() => {}) });
    renderApp(
      <SecretFormDialog
        target={{ type: 'create', kind: 'credentials', scope: 'global' }}
        onOpenChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Add secret' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading content' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeDisabled();
  });

  it('says why when the kinds cannot be read, and tries again on request', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /meta', failure(503, 'network'));
    const { user } = renderApp(
      <SecretFormDialog
        target={{ type: 'create', kind: 'credentials', scope: 'global' }}
        onOpenChange={() => {}}
      />,
    );
    const alert = await screen.findByRole('alert');
    // What could not be loaded, and nothing of the Try again beside it.
    expect(alert).toHaveTextContent("Couldn't load the secret types.");
    expect(alert).not.toHaveTextContent(errors.network);

    backend.api.on('GET /meta', meta());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('textbox', { name: 'Title' }),
    ).toBeInTheDocument();
  });
});

describe('accessibility of the form to add a secret', () => {
  it('has no violations in the first state, with fields added, with errors and after a refusal', async () => {
    const { user, api } = await renderCreate();
    await checkAccessibility(document.body);

    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Value' }), 'no label');
    await user.click(save());
    await screen.findByText(/Enter a label for this value/);
    await screen.findByText('Enter a title.');
    await checkAccessibility(document.body);

    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    await user.type(title(), 'T');
    api.on('POST /secrets', failure(422, 'invalid_secret', 'x'));
    await user.click(save());
    await screen.findByRole('alert');
    await checkAccessibility(document.body);
  });

  it('has no violations for each kind', async () => {
    const { user } = await renderCreate();
    for (const kind of ['Personal information', 'Credit card', 'Note']) {
      await chooseKind(user, kind);
      await checkAccessibility(document.body);
    }
  });
});

describe('the form to add a secret in German', () => {
  it('speaks German, names the starting fields in German and still sends their English labels', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { user, api } = await renderCreate({ ready: 'Titel' });
    expect(
      await screen.findByRole('dialog', { name: 'Secret hinzufügen' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Benutzername' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Passwort')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Typ' })).toHaveTextContent(
      'Zugangsdaten',
    );
    expect(screen.getByText('Verfügbar für')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Passwort anzeigen' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveAttribute(
      'placeholder',
      'z. B. Shop-Login',
    );

    // Pressed with a title only, it tells what to do next.
    await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'Shop');
    await user.click(screen.getByRole('button', { name: 'Secret hinzufügen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Gib mindestens einen Wert ein.',
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Benutzername' }),
      'ada',
    );
    await user.click(screen.getByRole('button', { name: 'Secret hinzufügen' }));

    await waitFor(() => expect(createBody(api)).toBeDefined());
    expect(createBody(api)).toMatchObject({
      fields: [{ label: 'Username', value: 'ada' }],
    });
  });

  it('says its refusals in German, with the limits as German reads numbers', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { user } = await renderCreate({ ready: 'Titel' });
    await screen.findByRole('dialog', { name: 'Secret hinzufügen' });
    await user.click(screen.getByRole('textbox', { name: 'Titel' }));
    await user.paste('a'.repeat(MAX_TITLE + 1));
    fireEvent.change(screen.getByLabelText('Passwort'), {
      target: { value: 'p'.repeat(MAX_VALUE + 1) },
    });
    await user.click(screen.getByRole('button', { name: 'Secret hinzufügen' }));
    expect(
      await screen.findByText('Kürze den Titel auf höchstens 120 Zeichen.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Kürze „Passwort“ auf höchstens 20.000 Zeichen.'),
    ).toBeInTheDocument();
  });

  it('speaks French as well', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    await renderCreate({ ready: 'Titre' });
    expect(
      await screen.findByRole('dialog', { name: 'Ajouter un secret' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: "Nom d'utilisateur" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Mot de passe')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Afficher «\u00a0Mot de passe\u00a0»',
      }),
    ).toBeInTheDocument();
  });
});
