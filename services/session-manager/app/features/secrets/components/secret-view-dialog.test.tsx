import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import errors from '@/messages/en/errors.yml';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure } from '@/tests/utils/fake-api';
import { renderApp } from '@/tests/utils/render';
import {
  installSecretsApi,
  SAMPLE,
  summaryOf,
} from '@/tests/utils/secrets-api';
import { openToastLines, ToastProbe } from '@/tests/utils/toast-probe';

import { SecretViewDialog } from './secret-view-dialog';

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await i18n.changeLanguage('en');
});

type Stored = (typeof SAMPLE)[keyof typeof SAMPLE];

async function renderView(secret: Stored = SAMPLE.credentials, ready = 'Edit') {
  const backend = installSecretsApi();
  const onOpenChange = vi.fn();
  const view = renderApp(
    <>
      <SecretViewDialog
        secret={summaryOf(secret)}
        onOpenChange={onOpenChange}
      />
      <ToastProbe />
    </>,
  );
  await screen.findByRole('button', { name: ready });
  return { ...view, ...backend, onOpenChange };
}

const PASSWORD = 'correct horse battery staple';

describe('the read dialog of a secret', () => {
  it('is named, and says what the secret is and who it is for', async () => {
    await renderView(SAMPLE.card);
    expect(
      screen.getByRole('dialog', { name: 'Secret details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Visa ending 4242' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Credit card · Session "0003"'),
    ).toBeInTheDocument();
  });

  it('shows each field under its label, in a pill with its value and its buttons', async () => {
    await renderView();
    const list = screen.getByRole('dialog');
    expect(
      within(list)
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-labelledby'))
        .map((id) => document.getElementById(id ?? '')?.textContent),
    ).toEqual(['Website', 'Username', 'Password']);
    expect(
      within(list).getByText('https://shop.example.com'),
    ).toBeInTheDocument();
    expect(within(list).getByText('ada@example.com')).toBeInTheDocument();
  });

  it('has no hand-made rows: the values are the shared pills of a value to copy', async () => {
    await renderView();
    const website = screen.getByRole('group', { name: 'Website' });
    expect(
      within(website).getByRole('button', { name: 'Copy Website' }),
    ).toBeInTheDocument();
    expect(within(website).getByText('https://shop.example.com')).toBeVisible();
  });

  it('fetches the whole secret when it opens', async () => {
    const { api } = await renderView();
    expect(api.callsTo('GET /secrets/:id')).toHaveLength(1);
    expect(api.callsTo('GET /secrets/:id')[0]?.params.id).toBe('6');
  });

  it('keeps a hidden value out of the page until it is shown', async () => {
    await renderView();
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PASSWORD);
    // A row of dots stands for it, and says so to a screen reader.
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('shows a hidden value on request and hides it again', async () => {
    const { user } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Show Password' }));
    expect(screen.getByText(PASSWORD)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show Password' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide Password' }));
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  });

  it('shows one hidden value at a time: showing the password does not show the card number', async () => {
    const { user } = await renderView(SAMPLE.card);
    await user.click(screen.getByRole('button', { name: 'Show CVC' }));
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.queryByText('4242 4242 4242 4242')).not.toBeInTheDocument();
  });

  it('offers to show only what is hidden, and to copy every value', async () => {
    await renderView();
    expect(
      screen.queryByRole('button', { name: 'Show Website' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Show Username' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show Password' }),
    ).toBeInTheDocument();
    for (const label of ['Website', 'Username', 'Password']) {
      expect(
        screen.getByRole('button', { name: `Copy ${label}` }),
      ).toBeInTheDocument();
    }
  });

  it('copies a value, and says it did', async () => {
    const { user } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Copy Username' }));
    expect(await navigator.clipboard.readText()).toBe('ada@example.com');
    await waitFor(() =>
      expect(
        screen.getByText('Username copied', { selector: '[role="status"]' }),
      ).toBeInTheDocument(),
    );
  });

  it('copies a hidden value without showing it', async () => {
    const { user } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Copy Password' }));
    expect(await navigator.clipboard.readText()).toBe(PASSWORD);
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it('copies a value of several lines whole', async () => {
    const { user } = await renderView(SAMPLE.note, 'Edit');
    await user.click(screen.getByRole('button', { name: 'Copy Note' }));
    expect(await navigator.clipboard.readText()).toBe(
      'Network: Studio-5G\nGuests use the guest network.',
    );
  });

  it('shows a value of several lines with its lines', async () => {
    await renderView(SAMPLE.note);
    const value = screen.getByText(/Network: Studio-5G/);
    expect(value.textContent).toBe(
      'Network: Studio-5G\nGuests use the guest network.',
    );
  });

  it('tells the person when the browser does not let it copy', async () => {
    const { user } = await renderView();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied'),
    );
    await user.click(screen.getByRole('button', { name: 'Copy Username' }));
    await waitFor(() =>
      expect(openToastLines()).toEqual([
        "destructive: Couldn't copy to clipboard",
      ]),
    );
  });

  it('shows a label that no catalog knows as it was stored', async () => {
    await renderView(SAMPLE.bank);
    expect(screen.getByText('Backup code')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show Backup code' }),
    ).toBeInTheDocument();
  });

  it('closes with its close button and with Escape', async () => {
    const { user, onOpenChange } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('the read dialog while the secret is on its way', () => {
  it('shows what the list knew and masks the rest, with no way to edit', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets/:id', () => new Promise(() => {}));
    renderApp(
      <SecretViewDialog
        secret={summaryOf(SAMPLE.credentials)}
        onOpenChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Example shop' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: 'Loading content' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    await checkAccessibility(document.body);
  });

  it('says why the secret did not come and fetches it again on request', async () => {
    const backend = installSecretsApi();
    backend.api.on('GET /secrets/:id', failure(503, 'network'));
    const { user } = renderApp(
      <SecretViewDialog
        secret={summaryOf(SAMPLE.credentials)}
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
    expect(await screen.findByText('Username')).toBeInTheDocument();
  });

  it('says a secret that is gone is gone', async () => {
    installSecretsApi({ secrets: [] });
    renderApp(
      <SecretViewDialog
        secret={summaryOf(SAMPLE.credentials)}
        onOpenChange={() => {}}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This secret no longer exists.',
    );
  });
});

describe('changing a secret from its read dialog', () => {
  it('hands the dialog over to the form of the secret', async () => {
    const { user } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(
      await screen.findByRole('dialog', { name: 'Edit secret' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Secret details' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: 'Title' })).toHaveValue(
      'Example shop',
    );
  });

  it('comes back to the details when the form is cancelled', async () => {
    const { user, onOpenChange } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('textbox', { name: 'Title' });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      await screen.findByRole('dialog', { name: 'Secret details' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit secret' }),
    ).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes both dialogs once the secret is saved', async () => {
    const { user, onOpenChange, api } = await renderView();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await user.type(title, '!');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.callsTo('PATCH /secrets/:id')).toHaveLength(1);
    expect(openToastLines()).toEqual(['success: Secret updated']);
  });
});

describe('the read dialog of a secret and its accessibility', () => {
  it('has no violations with a hidden value and with it shown', async () => {
    const { user } = await renderView(SAMPLE.card);
    await checkAccessibility(document.body);
    await user.click(screen.getByRole('button', { name: 'Show Card number' }));
    await checkAccessibility(document.body);
  });
});

describe('the read dialog of a secret in other languages', () => {
  it('speaks German and shows the labels the server stored in English in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    await renderView(SAMPLE.credentials, 'Bearbeiten');
    expect(
      screen.getByRole('dialog', { name: 'Secret-Details' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Zugangsdaten · Jede Sitzung')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('group')
        .map((group) => group.getAttribute('aria-labelledby'))
        .map((id) => document.getElementById(id ?? '')?.textContent),
    ).toEqual(['Website', 'Benutzername', 'Passwort']);
    expect(
      screen.getByRole('button', { name: 'Passwort anzeigen' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Passwort kopieren' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Verborgen')).toBeInTheDocument();
  });

  it('speaks French', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    await renderView(SAMPLE.credentials, 'Modifier');
    expect(
      screen.getByRole('dialog', { name: 'Détails du secret' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Afficher «\u00a0Mot de passe\u00a0»',
      }),
    ).toBeInTheDocument();
  });
});
