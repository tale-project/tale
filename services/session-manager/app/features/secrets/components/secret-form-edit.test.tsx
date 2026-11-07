import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { secretUpdateSchema } from '@/lib/api/schemas';
import { i18n } from '@/lib/i18n/i18n';
import { MAX_FIELDS } from '@/lib/secret-limits';
import errors from '@/messages/en/errors.yml';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure } from '@/tests/utils/fake-api';
import { secret } from '@/tests/utils/fixtures';
import { countWrites, heldByWrites } from '@/tests/utils/mutation-cache';
import { renderApp } from '@/tests/utils/render';
import {
  allSecrets,
  field,
  installSecretsApi,
  SAMPLE,
  summaryOf,
} from '@/tests/utils/secrets-api';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

import { SecretFormDialog } from './secret-form-dialog';

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

type Stored = (typeof SAMPLE)[keyof typeof SAMPLE];

interface EditOptions {
  secret?: Stored;
  /** The name the form is ready by, which is not English in German. */
  ready?: string;
}

/** The form to change a secret, once the whole secret has come. */
async function renderEdit({
  secret: stored = SAMPLE.credentials,
  ready = 'Title',
}: EditOptions = {}) {
  // The secret is the backend's own, even when it is none of the samples.
  const backend = installSecretsApi({ secrets: [stored, ...allSecrets()] });
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const view = renderApp(
    <>
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(stored) }}
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
const save = () => screen.getByRole('button', { name: 'Save' });
/** A value's field by its label: a hidden value is a password field, which has no role of a text field. */
const box = (name: string) => screen.getByLabelText(name);
/** The button of the list of sessions: named by its label, it shows who it is for. */
const scope = () => screen.getByRole('button', { name: 'Available to' });

const patchBody = (api: Awaited<ReturnType<typeof renderEdit>>['api']) =>
  secretUpdateSchema.parse(api.callsTo('PATCH /secrets/:id')[0]?.body);

describe('the form to change a secret', () => {
  it('fetches the whole secret when it opens, and nothing else of the secrets', async () => {
    const { api } = await renderEdit();
    expect(api.callsTo('GET /secrets/:id')).toHaveLength(1);
    expect(api.callsTo('GET /secrets/:id')[0]?.params.id).toBe('6');
    expect(api.callsTo('GET /secrets')).toHaveLength(0);
  });

  it('shows the title and every value, the hidden ones masked, and the kind it is of', async () => {
    await renderEdit();
    expect(
      screen.getByRole('dialog', { name: 'Edit secret' }),
    ).toHaveAccessibleDescription('Credentials');
    expect(title()).toHaveValue('Example shop');
    expect(box('Website')).toHaveValue('https://shop.example.com');
    expect(box('Username')).toHaveValue('ada@example.com');
    expect(box('Password')).toHaveValue('correct horse battery staple');
    // The password is masked, with the means to show it and to copy it.
    expect(
      screen.getByRole('button', { name: 'Show Password' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByRole('button', { name: 'Copy Password' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show Website' }),
    ).not.toBeInTheDocument();
    // Whether a value is hidden is not asked here either.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('puts a hidden value in no text of the page, only behind its field', async () => {
    await renderEdit();
    expect(
      screen.queryByText('correct horse battery staple'),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      'correct horse battery staple',
    );
  });

  it('cannot change the kind of the secret', async () => {
    await renderEdit();
    expect(
      screen.queryByRole('combobox', { name: 'Type' }),
    ).not.toBeInTheDocument();
  });

  it('is for the session the secret is for, or for every session', async () => {
    await renderEdit({ secret: SAMPLE.mail });
    await waitFor(() => expect(scope()).toHaveTextContent('Session "0003"'));
  });

  it('opens a card with its number and its CVC masked', async () => {
    await renderEdit({ secret: SAMPLE.card });
    expect(box('Card number')).toHaveValue('4242 4242 4242 4242');
    expect(
      screen.getByRole('button', { name: 'Show Card number' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show CVC' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show Expiration date' }),
    ).not.toBeInTheDocument();
  });

  it('opens an address of several lines in a text area', async () => {
    await renderEdit({ secret: SAMPLE.personal });
    expect(box('Address').tagName).toBe('TEXTAREA');
    expect(box('Address')).toHaveValue('Unter den Linden 1\n10117 Berlin');
  });

  it("shows the fields the secret has beyond the kind's as rows of their own, with the label they were saved under", async () => {
    await renderEdit({ secret: SAMPLE.bank });
    const group = screen.getByRole('group', { name: 'Backup code' });
    expect(within(group).getByRole('textbox', { name: 'Label' })).toHaveValue(
      'Backup code',
    );
    expect(within(group).getByLabelText('Value')).toHaveValue('8814-2290-6613');
    expect(
      within(group).getByRole('button', { name: 'Show Backup code' }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole('button', { name: 'Copy Backup code' }),
    ).toBeInTheDocument();
  });

  it('keeps the flag a field is stored with: a value that is shown is not masked because its label sounds private', async () => {
    const odd = secret({
      id: 21,
      kind: 'credentials',
      title: 'Odd',
      fields: [
        field('Website', 'x.test'),
        field('Pass phrase', 'visible on purpose', false),
      ],
    });
    installSecretsApi({ secrets: [odd] });
    renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(odd) }}
        onOpenChange={() => {}}
      />,
    );
    const group = await screen.findByRole('group', { name: 'Pass phrase' });
    const value = within(group).getByRole('textbox', { name: 'Value' });
    expect(value).toHaveValue('visible on purpose');
    expect(
      within(group).queryByRole('button', { name: 'Show Pass phrase' }),
    ).not.toBeInTheDocument();
  });
});

describe('a secret that holds nearly the most values it can', () => {
  it('offers no more fields once it has the most a secret can hold, and says why', async () => {
    // Three values of the kind and 36 more of its own: one more makes the 40
    // that a secret can hold. The form is opened with them, not built up one
    // click at a time: forty rows are slow to render over and over.
    const stored = secret({
      ...SAMPLE.credentials,
      id: 42,
      fields: [
        ...SAMPLE.credentials.fields,
        ...Array.from({ length: MAX_FIELDS - 4 }, (_, row) =>
          field(`Extra ${row + 1}`, `value ${row + 1}`),
        ),
      ],
    });
    const { user } = await renderEdit({ secret: stored });

    await user.click(screen.getByRole('button', { name: 'Add field' }));

    const full = screen.getByRole('button', { name: 'Add field' });
    expect(full).toHaveAttribute('aria-disabled', 'true');
    await user.hover(full);
    expect(
      await screen.findAllByText(
        `A secret can have at most ${MAX_FIELDS} values. Remove one to continue.`,
      ),
    ).not.toHaveLength(0);
  });
});

describe('while the secret is on its way', () => {
  it('shows the form in place, masked, and cannot be saved', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets/:id', () => new Promise(() => {}));
    renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(SAMPLE.credentials) }}
        onOpenChange={() => {}}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'Edit secret' }),
    ).toHaveAccessibleDescription('Credentials');
    expect(
      screen.getByRole('status', { name: 'Loading content' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await checkAccessibility(document.body);
  });

  it('says why the secret did not come, and fetches it again on request', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets/:id', failure(503, 'network'));
    const { user } = renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(SAMPLE.credentials) }}
        onOpenChange={() => {}}
      />,
    );

    const alert = await screen.findByRole('alert');
    // What could not be loaded, and nothing of the Try again beside it.
    expect(alert).toHaveTextContent("Couldn't load the secret.");
    expect(alert).not.toHaveTextContent(errors.network);
    await checkAccessibility(document.body);

    backend.api.on('GET /secrets/:id', SAMPLE.credentials);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Example shop',
    );
  });

  it('says a secret that no longer exists is gone', async () => {
    const backend = installSecretsApi({ secrets: [] });
    renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(SAMPLE.credentials) }}
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This secret no longer exists.',
    );
    expect(backend.api.callsTo('GET /secrets/:id')).toHaveLength(1);
  });
});

describe('saving a changed secret', () => {
  it('cannot be saved before anything changed', async () => {
    await renderEdit();
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it('does not count blanks around the title as a change', async () => {
    const { user } = await renderEdit();
    await user.type(title(), '   ');
    expect(save()).toBeDisabled();
  });

  it('sends only the title when only the title changed, says it is saved and closes', async () => {
    const { user, api, onOpenChange, onSaved } = await renderEdit();
    await user.clear(title());
    await user.type(title(), ' Shop 2 ');
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(patchBody(api)).toEqual({ title: 'Shop 2' });
    expect(api.callsTo('PATCH /secrets/:id')[0]?.params.id).toBe('6');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(openToastLines()).toEqual(['success: Secret updated']);
  });

  it('makes a secret one for every session by sending sessionId null, and nothing else', async () => {
    const { user, api, onOpenChange } = await renderEdit({
      secret: SAMPLE.mail,
    });
    await waitFor(() => expect(scope()).toHaveTextContent('Session "0003"'));
    await user.click(scope());
    await user.click(
      await screen.findByRole('option', { name: 'Every session' }),
    );
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const sent = api.callsTo('PATCH /secrets/:id')[0]?.body;
    expect(sent).toEqual({ sessionId: null });
    expect(patchBody(api).sessionId).toBeNull();
  });

  it('moves a secret to another session by its id, and nothing else', async () => {
    const { user, api, onOpenChange } = await renderEdit({
      secret: SAMPLE.credentials,
    });
    await user.click(scope());
    await user.click(
      await screen.findByRole('option', { name: 'Session "Shop EU"' }),
    );
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('PATCH /secrets/:id')[0]?.body).toEqual({
      sessionId: 12,
    });
  });

  it('sends all the fields, each with its flag, when one value changed', async () => {
    const { user, api, onOpenChange } = await renderEdit();
    await user.clear(box('Username'));
    await user.type(box('Username'), 'ada2');
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('PATCH /secrets/:id')[0]?.body).toEqual({
      fields: [
        { label: 'Website', value: 'https://shop.example.com', hidden: false },
        { label: 'Username', value: 'ada2', hidden: false },
        {
          label: 'Password',
          value: 'correct horse battery staple',
          hidden: true,
        },
      ],
    });
  });

  it('sends the changes of the title, the session and the values together', async () => {
    const { user, api } = await renderEdit();
    await user.type(title(), '!');
    await user.type(box('Website'), '/login');
    await user.click(scope());
    await user.click(
      await screen.findByRole('option', { name: 'Session "0001"' }),
    );
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    const body = patchBody(api);
    expect(body.title).toBe('Example shop!');
    expect(body.sessionId).toBe(1);
    expect(body.fields?.[0]).toEqual({
      label: 'Website',
      value: 'https://shop.example.com/login',
      hidden: false,
    });
  });

  it('drops a value that was cleared, as the server does', async () => {
    const { user, api } = await renderEdit();
    await user.clear(box('Username'));
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(patchBody(api).fields?.map((entry) => entry.label)).toEqual([
      'Website',
      'Password',
    ]);
  });

  it('removes a field the secret had beyond the kind', async () => {
    const { user, api } = await renderEdit({ secret: SAMPLE.bank });
    await user.click(
      screen.getByRole('button', { name: 'Remove Backup code' }),
    );
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(patchBody(api).fields?.map((entry) => entry.label)).toEqual([
      'Website',
      'Username',
      'Password',
    ]);
  });

  it('sends the flags of the stored values as they are stored, whatever the server would pick', async () => {
    const odd = secret({
      id: 21,
      kind: 'credentials',
      title: 'Odd',
      fields: [
        field('Website', 'x.test'),
        field('Pass phrase', 'visible on purpose', false),
      ],
    });
    const backend = installSecretsApi({ secrets: [odd] });
    const { user } = renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(odd) }}
        onOpenChange={() => {}}
      />,
    );
    await user.type(
      await screen.findByRole('textbox', { name: 'Website' }),
      '/',
    );
    await user.click(save());

    await waitFor(() =>
      expect(backend.api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(patchBody(backend.api).fields).toEqual([
      { label: 'Website', value: 'x.test/', hidden: false },
      { label: 'Pass phrase', value: 'visible on purpose', hidden: false },
    ]);
  });

  it('adds a field to a stored secret, hidden when its label names something private', async () => {
    const { user, api } = await renderEdit();
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'PIN');
    await user.type(screen.getByLabelText('Value'), '4821');
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(patchBody(api).fields).toHaveLength(4);
    expect(patchBody(api).fields?.[3]).toEqual({
      label: 'PIN',
      value: '4821',
      hidden: true,
    });
  });

  it('is saved the same once a change is put back as it was: it asks nothing and sends nothing', async () => {
    const confirm = vi.spyOn(globalThis, 'confirm');
    const { user, api, onOpenChange } = await renderEdit();
    await user.type(box('Username'), 'x');
    await user.type(box('Username'), '{Backspace}');
    expect(save()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(0);
  });

  it('does not rename a field the secret stores under another case, nor reorder fields it stored in another order', async () => {
    const stored = secret({
      id: 30,
      kind: 'credentials',
      title: 'Odd order',
      fields: [field('password', 'pw', true), field('website', 'x.test')],
    });
    const backend = installSecretsApi({ secrets: [stored] });
    const { user } = renderApp(
      <SecretFormDialog
        target={{ type: 'edit', secret: summaryOf(stored) }}
        onOpenChange={() => {}}
      />,
    );
    await user.type(await screen.findByRole('textbox', { name: 'Title' }), '!');
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(backend.api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(backend.api.callsTo('PATCH /secrets/:id')[0]?.body).toEqual({
      title: 'Odd order!',
    });
  });
});

describe('when saving a changed secret fails', () => {
  it('says that the secret is gone, in the form', async () => {
    const { user, api, onOpenChange } = await renderEdit();
    api.on('PATCH /secrets/:id', failure(404, 'secret_not_found'));
    await user.type(title(), '!');
    expect(save()).toBeEnabled();
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This secret no longer exists.',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(title()).toHaveValue('Example shop!');
    expect(openToastLines()).toEqual([]);
  });

  it('shows a refusal of the values on top of the form', async () => {
    const { user, api } = await renderEdit();
    api.on(
      'PATCH /secrets/:id',
      failure(422, 'invalid_secret', 'Fill in at least one value.'),
    );
    await user.type(title(), '!');
    expect(save()).toBeEnabled();
    await user.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Check the values of this secret.',
    );
  });

  it('raises one toast for any other failure, keeping the edits', async () => {
    const { user, api } = await renderEdit();
    api.on('PATCH /secrets/:id', failure(500, 'internal', 'x'));
    await user.type(title(), '!');
    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't save the secret",
      ]),
    );
    expect(title()).toHaveValue('Example shop!');
  });

  it('can be saved again after a failure', async () => {
    const { user, api, onOpenChange } = await renderEdit();
    api.on('PATCH /secrets/:id', failure(500, 'internal', 'x'));
    await user.type(title(), '!');
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(openToastLines()).toHaveLength(1));

    api.on('PATCH /secrets/:id', SAMPLE.credentials);
    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe('what the form leaves in the memory of the page', () => {
  // The mutation cache would keep what the form sent, hidden values included,
  // for five minutes after the form is gone.
  it('keeps none of the values once the changes are saved, with the form still on screen or gone', async () => {
    const { user, queryClient, unmount, onOpenChange } = await renderEdit();
    await user.clear(box('Password'));
    await user.type(box('Password'), 'PROBE-VALUE-4');

    await user.click(save());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-VALUE-4');
    unmount();
    expect(countWrites(queryClient)).toBe(0);
  });

  it('keeps none of them either when the server refused the changes', async () => {
    const { user, api, queryClient, unmount } = await renderEdit();
    api.on(
      'PATCH /secrets/:id',
      failure(422, 'invalid_secret', 'Enter a value.'),
    );
    await user.clear(box('Password'));
    await user.type(box('Password'), 'PROBE-VALUE-5');

    await user.click(save());

    await screen.findByRole('alert');
    await waitFor(() => expect(countWrites(queryClient)).toBe(0));
    expect(heldByWrites(queryClient)).not.toContain('PROBE-VALUE-5');
    expect(box('Password')).toHaveValue('PROBE-VALUE-5');
    unmount();
    expect(countWrites(queryClient)).toBe(0);
  });
});

describe('leaving the form to change a secret', () => {
  it('asks before it throws away an edit, and closes only when the person agrees', async () => {
    const confirm = vi
      .spyOn(globalThis, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { user, onOpenChange } = await renderEdit();
    await user.type(title(), '!');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes at once with the keyboard when nothing changed', async () => {
    const { user, onOpenChange } = await renderEdit();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('the form to change a secret and its accessibility', () => {
  it('has no violations loaded, with an added field, and after a refusal', async () => {
    const { user, api } = await renderEdit({ secret: SAMPLE.bank });
    await checkAccessibility(document.body);

    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await checkAccessibility(document.body);

    api.on('PATCH /secrets/:id', failure(404, 'secret_not_found'));
    await user.type(title(), '!');
    expect(save()).toBeEnabled();
    await user.click(save());
    await screen.findByRole('alert');
    await checkAccessibility(document.body);
  });
});

describe('the form to change a secret in German', () => {
  it('shows the labels the server stored in English in German, and sends them as they were', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    const { user, api } = await renderEdit({ ready: 'Titel' });
    expect(
      await screen.findByRole('dialog', { name: 'Secret bearbeiten' }),
    ).toHaveAccessibleDescription('Zugangsdaten');
    expect(screen.getByRole('textbox', { name: 'Benutzername' })).toHaveValue(
      'ada@example.com',
    );
    expect(screen.getByLabelText('Passwort')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Benutzername' }), '!');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1),
    );
    expect(patchBody(api).fields?.map((entry) => entry.label)).toEqual([
      'Website',
      'Username',
      'Password',
    ]);
    await waitFor(() =>
      expect(openToastLines()).toEqual(['success: Secret aktualisiert']),
    );
  });

  it('shows a label that no catalog knows as it was stored', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    await renderEdit({ secret: SAMPLE.bank, ready: 'Titel' });
    const group = await screen.findByRole('group', { name: 'Backup code' });
    expect(
      within(group).getByRole('textbox', { name: 'Bezeichnung' }),
    ).toHaveValue('Backup code');
  });
});
