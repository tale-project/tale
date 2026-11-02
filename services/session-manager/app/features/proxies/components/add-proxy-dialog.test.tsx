import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { proxy } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderInShell } from '@/tests/utils/render';

import { AddProxyDialog, type AddProxyDialogProps } from './add-proxy-dialog';

afterEach(resetLanguage);

function renderDialog(props: Partial<AddProxyDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onShow = vi.fn();
  const findProxy = vi.fn();
  const view = renderInShell(
    <AddProxyDialog
      open
      onOpenChange={onOpenChange}
      findProxy={findProxy}
      onShow={onShow}
      {...props}
    />,
  );
  return { ...view, onOpenChange, onShow, findProxy };
}

const field = () => screen.getByRole('textbox', { name: 'Proxy' });
const submit = () => screen.getByRole('button', { name: 'Add proxy' });

describe('AddProxyDialog', () => {
  it('opens on the field, with the way to write a proxy and the default type', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Add proxy' })).toBeVisible();
    expect(field()).toHaveFocus();
    // An example in the field, the formats in the hint under it.
    expect(field()).toHaveAttribute(
      'placeholder',
      'e.g. proxy.example.com:8080:user:pass',
    );
    expect(field()).toHaveAccessibleDescription(
      'Accepted formats: host:port, host:port:user:pass, user:pass:host:port, user:pass@host:port or a full address such as socks5://host:port.',
    );
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Proxy type');
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'HTTPS' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'SOCKS5' })).not.toBeChecked();
  });

  it('does not call a fresh form invalid when its field is blurred once, as a menu hands its focus back', async () => {
    renderDialog();

    await act(async () => {
      field().blur();
      field().focus();
    });

    expect(screen.queryByText('Enter a proxy.')).not.toBeInTheDocument();
    expect(field()).toBeValid();
  });

  it('shows nothing while closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds the proxy with the chosen type, says so and closes', async () => {
    const api = installFakeApi({ 'POST /proxies': proxy({ id: 9 }) });
    const { user, onOpenChange } = renderDialog();

    await user.type(field(), '1.2.3.4:8080:ada:secret');
    await user.click(screen.getByRole('radio', { name: 'SOCKS5' }));
    await user.click(submit());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('POST /proxies')[0]?.body).toEqual({
      proxy: '1.2.3.4:8080:ada:secret',
      defaultScheme: 'socks5',
    });
    expect(await screen.findByText('Proxy added')).toBeVisible();
  });

  it('tells the page a proxy was added, so it can show it', async () => {
    installFakeApi({ 'POST /proxies': proxy({ id: 9 }) });
    const onAdded = vi.fn();
    const { user, onOpenChange } = renderDialog({ onAdded });

    await user.type(field(), '1.2.3.4:8080{Enter}');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onAdded).toHaveBeenCalledTimes(1);
  });

  it('tells the page nothing when the proxy was refused', async () => {
    installFakeApi({
      'POST /proxies': failure(409, 'duplicate', 'x', { existingId: 4 }),
    });
    const onAdded = vi.fn();
    const { user } = renderDialog({ onAdded });

    await user.type(field(), '1.2.3.4:8080{Enter}');

    await screen.findByText('This proxy is already in the pool.');
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('adds with the Enter key, from the field', async () => {
    const api = installFakeApi({ 'POST /proxies': proxy({ id: 9 }) });
    const { user, onOpenChange } = renderDialog();

    await user.type(field(), '1.2.3.4:8080{Enter}');

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('POST /proxies')[0]?.body).toMatchObject({
      proxy: '1.2.3.4:8080',
      defaultScheme: 'http',
    });
  });

  it('keeps the dialog busy until the proxy is added', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'POST /proxies': async () => {
        await gate;
        return proxy({ id: 9 });
      },
    });
    const { user, onOpenChange } = renderDialog();

    await user.type(field(), '1.2.3.4:8080{Enter}');

    await waitFor(() => expect(submit()).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('asks for a proxy when none was entered, and sends nothing', async () => {
    const api = installFakeApi({});
    const { user } = renderDialog();

    await user.click(submit());

    expect(await screen.findByText('Enter a proxy.')).toBeVisible();
    expect(field()).toBeInvalid();
    expect(field()).toHaveFocus();
    expect(api.calls).toHaveLength(0);

    // Typing repairs it, and the error goes.
    await user.type(field(), '1');
    await waitFor(() =>
      expect(screen.queryByText('Enter a proxy.')).not.toBeInTheDocument(),
    );
    expect(field()).toBeValid();
  });

  it('does not take blanks for a proxy', async () => {
    const api = installFakeApi({});
    const { user } = renderDialog();

    await user.type(field(), '   ');
    await user.click(submit());

    expect(await screen.findByText('Enter a proxy.')).toBeVisible();
    expect(api.calls).toHaveLength(0);
  });

  it('words why a proxy cannot be read, beside the field, from the reason the server gives', async () => {
    installFakeApi({
      'POST /proxies': failure(422, 'invalid_proxy', 'Invalid proxy: …', {
        reason: 'missing_port',
        params: {},
      }),
    });
    const { user, onOpenChange } = renderDialog();

    await user.type(field(), 'example.com');
    await user.click(submit());

    expect(
      await screen.findByText(
        'The port is missing. Write the proxy as host:port.',
      ),
    ).toBeVisible();
    expect(field()).toBeInvalid();
    expect(field()).toHaveFocus();
    // What was typed stays to be repaired; nothing else was said.
    expect(field()).toHaveValue('example.com');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await user.type(field(), ':80');
    await waitFor(() => expect(field()).toBeValid());
  });

  it('names the value the reason is about', async () => {
    installFakeApi({
      'POST /proxies': failure(422, 'invalid_proxy', 'x', {
        reason: 'invalid_port_value',
        params: { port: '99999' },
      }),
    });
    const { user } = renderDialog();

    await user.type(field(), '1.2.3.4:99999:ada:secret');
    await user.click(submit());

    expect(
      await screen.findByText(
        'Invalid port 99999. A port is a number from 1 to 65535.',
      ),
    ).toBeVisible();
  });

  it.each([
    ['without a reason', {}],
    ['for a reason it has no words for', { reason: 'from_the_future' }],
  ])('says it is not a valid proxy %s', async (_case, extra) => {
    installFakeApi({
      'POST /proxies': failure(422, 'invalid_proxy', 'Backend English', extra),
    });
    const { user } = renderDialog();

    await user.type(field(), 'nonsense');
    await user.click(submit());

    expect(await screen.findByText("This isn't a valid proxy.")).toBeVisible();
    expect(screen.queryByText('Backend English')).not.toBeInTheDocument();
  });

  it('names the proxy a duplicate repeats, and shows it in the list on request', async () => {
    installFakeApi({
      'POST /proxies': failure(409, 'duplicate', 'x', { existingId: 4 }),
    });
    const findProxy = vi.fn((id: number) =>
      id === 4 ? proxy({ id: 4, username: 'ada' }) : undefined,
    );
    const { user, onShow, onOpenChange } = renderDialog({ findProxy });

    await user.type(field(), '198.51.100.4:8080:ada:secret');
    await user.click(submit());

    expect(
      await screen.findByText(
        'This proxy is already in the pool as http://ada@198.51.100.4:8080.',
      ),
    ).toBeVisible();
    expect(field()).toBeInvalid();

    await user.click(screen.getByRole('button', { name: 'Show in list' }));
    expect(onShow).toHaveBeenCalledWith('198.51.100.4:8080');
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('says a duplicate exists even when the proxy it repeats is not loaded', async () => {
    installFakeApi({
      'POST /proxies': failure(409, 'duplicate', 'x', { existingId: 99 }),
    });
    const { user } = renderDialog();

    await user.type(field(), '1.2.3.4:8080');
    await user.click(submit());

    expect(
      await screen.findByText('This proxy is already in the pool.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Show in list' }),
    ).not.toBeInTheDocument();
  });

  it('drops the way to the duplicate once the text changes', async () => {
    installFakeApi({
      'POST /proxies': failure(409, 'duplicate', 'x', { existingId: 4 }),
    });
    const { user } = renderDialog({ findProxy: () => proxy({ id: 4 }) });

    await user.type(field(), '198.51.100.4:8080');
    await user.click(submit());
    await screen.findByRole('button', { name: 'Show in list' });

    await user.type(field(), '1');

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Show in list' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('says to check the values when the server finds them invalid', async () => {
    installFakeApi({
      'POST /proxies': failure(422, 'validation_error', 'x'),
    });
    const { user } = renderDialog();

    await user.type(field(), 'x');
    await user.click(submit());

    expect(
      await screen.findByText('Check the values and try again.'),
    ).toBeVisible();
  });

  it('tells any other failure in one toast and keeps the dialog for another try', async () => {
    installFakeApi({
      'POST /proxies': failure(500, 'internal', 'The server is on fire'),
    });
    const { user, onOpenChange } = renderDialog();

    await user.type(field(), '1.2.3.4:8080');
    await user.click(submit());

    expect(await screen.findByText("Couldn't add the proxy")).toBeVisible();
    // A code the app has no words for: not the backend's own English.
    expect(screen.getByText('Something went wrong. Try again.')).toBeVisible();
    expect(screen.queryByText('The server is on fire')).not.toBeInTheDocument();
    expect(screen.getAllByText("Couldn't add the proxy")).toHaveLength(1);
    expect(field()).toHaveValue('1.2.3.4:8080');
    expect(field()).toBeValid();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(submit()).toBeEnabled();
  });

  it('closes on Cancel and on Escape', async () => {
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('speaks German', async () => {
    await showLanguage('de');
    renderDialog();

    expect(
      screen.getByRole('dialog', { name: 'Proxy hinzufügen' }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Proxy' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'HTTP' })).toBeChecked();
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Proxy-Typ');
    expect(screen.getByRole('textbox', { name: 'Proxy' })).toHaveAttribute(
      'placeholder',
      'z. B. proxy.example.com:8080:user:pass',
    );
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderDialog();
    await checkAccessibility(document.body);
    view.unmount();
  });

  it('has no accessibility violations with an error shown', async () => {
    installFakeApi({
      'POST /proxies': failure(422, 'invalid_proxy', 'x', {
        reason: 'missing_port',
      }),
    });
    const { user } = renderDialog();
    await user.type(field(), 'example.com');
    await user.click(submit());
    await screen.findByText(/The port is missing/);

    await checkAccessibility(document.body);
  });
});
