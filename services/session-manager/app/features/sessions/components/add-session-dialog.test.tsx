import { screen, waitFor, within } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { errorText } from '@/tests/utils/errors';
import { navigate } from '@/tests/utils/sessions-router';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { AddSessionDialog } from './add-session-dialog';
import { ProxyFlowProvider } from './proxy-flow-provider';

/** The dialog the way a panel mounts it: it is there while it is open. */
function Host({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <AddSessionDialog
      open
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
    />
  ) : null;
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const view = renderApp(
    <ProxyFlowProvider>
      <Host onOpenChange={onOpenChange} />
      <ToastList />
    </ProxyFlowProvider>,
  );
  return { ...view, onOpenChange };
}

/** The answers of a route, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

const nameField = () => screen.getByRole('textbox', { name: /Name/ });
const submit = () => screen.getByRole('button', { name: 'Add session' });

beforeEach(() => {
  navigate.mockClear();
});

describe('AddSessionDialog', () => {
  it('asks for a name that may stay empty, and for the system', async () => {
    installFakeApi({ 'GET /meta': meta({ nextSessionName: '0007' }) });
    renderDialog();

    const dialog = await screen.findByRole('dialog', { name: 'Add session' });
    expect(dialog).toHaveTextContent(
      'The session starts right away, with a proxy of its own.',
    );
    expect(nameField()).toBeEnabled();
    expect(nameField()).not.toBeRequired();
    // Said where it is read, not as a placeholder that is gone once typed in.
    expect(nameField()).toHaveAccessibleDescription(
      'Leave blank to use the next free number.',
    );
    expect(nameField()).toHaveAttribute('maxlength', '80');
    // Without a name, the session gets the next free number.
    await waitFor(() =>
      expect(nameField()).toHaveAttribute('placeholder', '0007'),
    );
    expect(nameField()).toHaveFocus();
    expect(
      screen.getByRole('combobox', { name: 'Operating system' }),
    ).toHaveTextContent('Random');
  });

  it('offers the systems the app knows, in words', async () => {
    installFakeApi({ 'GET /meta': meta() });
    const { user } = renderDialog();

    await user.click(
      await screen.findByRole('combobox', { name: 'Operating system' }),
    );

    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Random', 'Windows', 'macOS', 'Linux']);
  });

  it('leaves out a system the backend does not offer', async () => {
    installFakeApi({
      'GET /meta': meta({ osOptions: ['random', 'linux'] }),
    });
    const { user } = renderDialog();
    // The options follow the answer of the backend once it arrived.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    await user.click(
      screen.getByRole('combobox', { name: 'Operating system' }),
    );

    await waitFor(() =>
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Random', 'Linux']),
    );
  });

  it('adds a session with the defaults: no name, a random system; then opens it', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': session({ id: 9, name: '0001', status: 'starting' }),
    });
    const { user, onOpenChange } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(submit());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('POST /sessions')[0]?.body).toEqual({ os: 'random' });
    expect(navigate).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: '9' },
    });
  });

  it('sends the name without its spaces and the system that was chosen', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': session({ id: 3, name: 'Shop' }),
    });
    const { user } = renderDialog();
    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      '  Shop  ',
    );
    await user.click(
      screen.getByRole('combobox', { name: 'Operating system' }),
    );
    await user.click(await screen.findByRole('option', { name: 'macOS' }));

    await user.click(submit());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(api.callsTo('POST /sessions')[0]?.body).toEqual({
      name: 'Shop',
      os: 'macos',
    });
  });

  it('can be submitted from the name field with Enter', async () => {
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': session(),
    });
    const { user } = renderDialog();
    await screen.findByRole('dialog');

    await user.type(nameField(), 'Shop{Enter}');

    await waitFor(() => expect(api.callsTo('POST /sessions')).toHaveLength(1));
  });

  it('tells a name that is taken beside the field, not as a toast, and keeps what was typed', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': failure(409, 'name_taken'),
    });
    const { user, onOpenChange } = renderDialog();
    await user.type(
      await screen.findByRole('textbox', { name: /Name/ }),
      'Shop',
    );

    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      errorText('name_taken'),
    );
    expect(nameField()).toBeInvalid();
    expect(nameField()).toHaveValue('Shop');
    // The keyboard is where the message is, ready to change the name.
    expect(nameField()).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(shownToasts()).toEqual([]);
    await checkAccessibility(screen.getByRole('dialog'));

    // Typing again takes the message away.
    await user.type(nameField(), '2');
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
  });

  it('tells a name the backend finds invalid beside the field', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': failure(422, 'invalid_name'),
    });
    const { user } = renderDialog();
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'x');

    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      errorText('invalid_name'),
    );
    expect(shownToasts()).toEqual([]);
  });

  describe('when no proxy is free', () => {
    const imported = {
      added: [proxy({ id: 5 })],
      duplicates: [],
      errors: [],
      summary: 'Added 1',
    };

    async function addProxies(user: ReturnType<typeof renderDialog>['user']) {
      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      await user.click(
        within(dialog).getByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.9:8080');
      await user.click(
        within(dialog).getByRole('button', { name: 'Add proxies' }),
      );
    }

    it('gives way to the dialog that adds proxies, which says the session is added once there are some', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': failure(409, 'no_free_proxy'),
      });
      const { user, onOpenChange } = renderDialog();
      await screen.findByRole('dialog');

      await user.click(submit());

      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        'Every session needs a proxy of its own, and none is free right now. Add proxies and the session will be added automatically.',
      );
      // One dialog at a time: this one is closed.
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
      await checkAccessibility(dialog);
    });

    it('adds the session with the name and the system that were given, once proxies are added, and opens it', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': sequence(
          failure(409, 'no_free_proxy'),
          session({ id: 9, name: 'Shop', status: 'starting' }),
        ),
        'POST /proxies/import': imported,
        'GET /sessions/:id': session({ id: 9, status: 'running' }),
      });
      const { user } = renderDialog();
      await user.type(
        await screen.findByRole('textbox', { name: /Name/ }),
        'Shop',
      );
      await user.click(
        screen.getByRole('combobox', { name: 'Operating system' }),
      );
      await user.click(await screen.findByRole('option', { name: 'macOS' }));
      await user.click(submit());

      await addProxies(user);

      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          to: '/sessions/$sessionId',
          params: { sessionId: '9' },
        }),
      );
      expect(api.callsTo('POST /sessions').map((call) => call.body)).toEqual([
        { name: 'Shop', os: 'macos' },
        { name: 'Shop', os: 'macos' },
      ]);
      expect(shownToasts().map((toast) => toast.title)).not.toContain(
        "Couldn't add the session",
      );
    });

    it('adds nothing, quietly, when the person gives up', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': failure(409, 'no_free_proxy'),
      });
      const { user } = renderDialog();
      await screen.findByRole('dialog');
      await user.click(submit());
      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('returns the keyboard to the button that opened it when the form that adds proxies is given up', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': failure(409, 'no_free_proxy'),
      });
      // The button that opens the dialog, as the panel's header has it.
      function Panel() {
        const [adding, setAdding] = useState(false);
        return (
          <>
            <button type="button" onClick={() => setAdding(true)}>
              New session
            </button>
            {adding && <AddSessionDialog open onOpenChange={setAdding} />}
          </>
        );
      }
      // The dev server runs the page in StrictMode, which sets a dialog that
      // mounts open up twice: the second time the dialog has the keyboard.
      const { user } = renderApp(
        <StrictMode>
          <ProxyFlowProvider>
            <Panel />
          </ProxyFlowProvider>
        </StrictMode>,
      );
      const opener = await screen.findByRole('button', { name: 'New session' });
      opener.focus();

      await user.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: 'Add session' });
      // The name may stay empty: Enter in its field adds the session.
      await user.keyboard('{Enter}');
      await screen.findByRole('dialog', { name: 'No free proxy available' });
      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(opener).toHaveFocus();
    });

    it('asks again when there is still no free proxy after some were added', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': sequence(
          failure(409, 'no_free_proxy'),
          failure(409, 'no_free_proxy'),
          session({ id: 9 }),
        ),
        'POST /proxies/import': imported,
        'GET /sessions/:id': session({ id: 9, status: 'running' }),
      });
      const { user } = renderDialog();
      await screen.findByRole('dialog');
      await user.click(submit());
      await addProxies(user);

      await waitFor(() =>
        expect(screen.getAllByRole('dialog')).toHaveLength(1),
      );
      await addProxies(user);

      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    });

    it('tells a name that was taken meanwhile, as a toast, because the dialog that had the field is gone', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions': sequence(
          failure(409, 'no_free_proxy'),
          failure(409, 'name_taken'),
        ),
        'POST /proxies/import': imported,
      });
      const { user } = renderDialog();
      await user.type(
        await screen.findByRole('textbox', { name: /Name/ }),
        'Shop',
      );
      await user.click(submit());
      await addProxies(user);

      await waitFor(() =>
        expect(shownToasts()).toContainEqual({
          title: "Couldn't add the session",
          description: errorText('name_taken'),
        }),
      );
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  it('tells any other refusal once, as a toast, and keeps the dialog open', async () => {
    installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': failure(409, 'fingerprint_exhausted'),
    });
    const { user, onOpenChange } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(submit());

    await waitFor(() => expect(shownToasts()).toHaveLength(1));
    expect(shownToasts()[0]).toEqual({
      title: "Couldn't add the session",
      description:
        "Couldn't generate a new fingerprint that differs from every existing session. Try another operating system.",
    });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the work under way and cannot be submitted twice', async () => {
    let finish: (() => void) | undefined;
    const api = installFakeApi({
      'GET /meta': meta(),
      'POST /sessions': () =>
        new Promise((resolve) => {
          finish = () => resolve(session());
        }),
    });
    const { user } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(submit());

    await waitFor(() => expect(submit()).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Enter}');
    finish?.();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(api.callsTo('POST /sessions')).toHaveLength(1);
  });

  describe('while the browser is not there', () => {
    it('says why a session cannot be added, and cannot be submitted', async () => {
      const api = installFakeApi({
        'GET /meta': meta({ browserInstalled: false }),
      });
      const { user } = renderDialog();

      const dialog = await screen.findByRole('dialog');
      await waitFor(() =>
        expect(dialog).toHaveTextContent("The browser isn't installed yet."),
      );
      expect(submit()).toBeDisabled();
      await user.type(nameField(), '{Enter}');
      expect(api.callsTo('POST /sessions')).toHaveLength(0);
      await checkAccessibility(dialog);
    });

    it('says the browser is being installed', async () => {
      installFakeApi({
        'GET /meta': meta({ browserInstalled: false, browserInstalling: true }),
      });
      renderDialog();
      expect(
        await screen.findByText('The browser is being installed.'),
      ).toBeInTheDocument();
    });
  });

  it('closes without a request on Cancel', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    const { user, onOpenChange } = renderDialog();
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(api.callsTo('POST /sessions')).toHaveLength(0);
  });

  it('closes without a request on Escape', async () => {
    const api = installFakeApi({ 'GET /meta': meta() });
    const { user, onOpenChange } = renderDialog();
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(api.callsTo('POST /sessions')).toHaveLength(0);
  });

  it('has no accessibility violations', async () => {
    installFakeApi({ 'GET /meta': meta() });
    renderDialog();
    await checkAccessibility(await screen.findByRole('dialog'));
  });
});
