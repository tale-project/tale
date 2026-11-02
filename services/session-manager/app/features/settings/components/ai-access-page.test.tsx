import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const { recordToasts } = await import('@/tests/utils/toast-recorder');
  return recordToasts(
    await importOriginal<typeof import('@tale/ui/use-toast')>(),
  );
});

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, settings } from '@/tests/utils/fixtures';
import { installSettingsApi } from '@/tests/utils/settings-api';
import { renderSettings } from '@/tests/utils/settings-router';
import { failureToasts, raised } from '@/tests/utils/toast-recorder';

beforeEach(() => {
  raised.length = 0;
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});

const SWITCH = 'Allow AI assistants to connect';
const toggle = () => screen.findByRole('switch', { name: SWITCH });

/** What the page says while AI access is off, and what only it says. */
const WHAT_ON_DOES =
  'Switch AI access on to see how to add Session Manager to an assistant.';
const connectHeading = () =>
  screen.queryByRole('heading', { name: 'Connect an assistant' });
const toolsHeading = () =>
  screen.queryByRole('heading', { name: 'What assistants can do' });

/** Nothing of the explanation: how to connect, the address, the tools. */
function expectNoExplanation() {
  expect(connectHeading()).toBeNull();
  expect(toolsHeading()).toBeNull();
  expect(screen.queryByText('Address')).toBeNull();
  expect(screen.queryByText(/claude mcp add/)).toBeNull();
  expect(screen.queryByRole('button', { name: /^Copy for/ })).toBeNull();
  expect(screen.queryByText('Overview and settings')).toBeNull();
}

async function openAiAccess(viewport: 'desktop' | 'phone' = 'desktop') {
  const view = renderSettings({ at: '/settings/ai-access', viewport });
  const control = await toggle();
  return { ...view, control };
}

describe('AI access page: the switch', () => {
  it('explains what AI access is and that only the person can change it', async () => {
    installSettingsApi();
    const { control } = await openAiAccess();

    expect(
      screen.getByRole('heading', { level: 2, name: 'AI assistants' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Let an AI assistant such as Claude use Session Manager through MCP. It can run sessions, browse in them, and manage proxies, secrets and settings for you.',
      ),
    ).toBeInTheDocument();
    expect(control).toHaveAccessibleDescription(
      'Takes effect at once. Only you can switch this on or off, not an assistant.',
    );
  });

  it('is off while AI access is off, and on when it is on', async () => {
    installSettingsApi();
    const off = await openAiAccess();
    expect(off.control).not.toBeChecked();
    off.unmount();

    installSettingsApi({ settings: settings({ mcpEnabled: true }) });
    const on = await openAiAccess();
    await waitFor(() => expect(on.control).toBeChecked());
  });

  it('switches AI access on at once, with nothing to save', async () => {
    const { api, server } = installSettingsApi();
    const { user, control } = await openAiAccess();

    await user.click(control);

    await waitFor(() => expect(control).toBeChecked());
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      mcpEnabled: true,
    });
    expect(server.settings.mcpEnabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(raised.filter((toast) => toast.variant === 'destructive')).toEqual(
      [],
    );
  });

  it('switches it off again', async () => {
    const { api } = installSettingsApi({
      settings: settings({ mcpEnabled: true }),
    });
    const { user, control } = await openAiAccess();
    await waitFor(() => expect(control).toBeChecked());

    await user.click(control);

    await waitFor(() => expect(control).not.toBeChecked());
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      mcpEnabled: false,
    });
  });

  it('shows where the switch is going while the change is on its way, and waits for it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stored = settings();
    const api = installFakeApi({
      'GET /settings': () => stored,
      'GET /meta': meta(),
      'PATCH /settings': async () => {
        await gate;
        stored = settings({ mcpEnabled: true });
        return stored;
      },
    });
    const { user, control } = await openAiAccess();

    await user.click(control);

    await waitFor(() => expect(control).toBeChecked());
    expect(control).toHaveAttribute('aria-busy', 'true');
    // A second click while the first is on its way changes nothing.
    await user.click(control);
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(control).not.toHaveAttribute('aria-busy'));
    expect(control).toBeChecked();
  });

  it('is switched with the keyboard, and keeps the focus afterwards', async () => {
    const { api } = installSettingsApi();
    const { user, control } = await openAiAccess();

    await user.tab();
    control.focus();
    expect(control).toHaveFocus();
    await user.keyboard(' ');

    await waitFor(() => expect(control).toBeChecked());
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
    expect(control).toHaveFocus();
  });

  it('puts the switch back and tells the failure once when the server refuses', async () => {
    installFakeApi({
      'GET /settings': settings(),
      'GET /meta': meta(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { user, control } = await openAiAccess();

    await user.click(control);

    await screen.findByText('This session is busy. Try again in a moment.');
    expect(failureToasts()).toHaveLength(1);
    expect(failureToasts()[0]).toMatchObject({
      title: "Couldn't change AI access",
    });
    await waitFor(() => expect(control).not.toBeChecked());
    expect(control).toHaveFocus();
  });

  it('masks the switch while the settings load, with the warning already there and nothing of the explanation', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /settings': async () => {
        await gate;
        return settings({ mcpEnabled: true });
      },
      'GET /meta': meta(),
    });
    renderSettings({ at: '/settings/ai-access' });

    await screen.findByRole('status', { name: 'Loading content' });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(SWITCH)).toBeInTheDocument();
    expect(screen.getByText(/read every secret/)).toBeInTheDocument();
    // Not knowing whether it is on, the page says neither how to connect nor
    // what switching it on does: no flash of either.
    expectNoExplanation();
    expect(screen.queryByText(WHAT_ON_DOES)).toBeNull();

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(async () => expect(await toggle()).toBeChecked());
    expect(
      await screen.findByRole('heading', { name: 'Connect an assistant' }),
    ).toBeInTheDocument();
  });

  it('says the settings could not be loaded in the switch’s place, with a retry', async () => {
    let healthy = false;
    installFakeApi({
      'GET /settings': () =>
        healthy ? settings({ mcpEnabled: true }) : failure(503, 'network'),
      'GET /meta': meta(),
    });
    const { user } = renderSettings({ at: '/settings/ai-access' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the settings.");
    expect(alert).not.toHaveTextContent("Can't reach Session Manager");
    // An off nobody read would be a claim: there is no switch to mislead.
    expect(screen.queryByRole('switch')).toBeNull();
    // What does not depend on the settings is still there; what does is not.
    expect(screen.getByText(/read every secret/)).toBeInTheDocument();
    expectNoExplanation();
    expect(screen.queryByText(WHAT_ON_DOES)).toBeNull();

    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    await waitFor(async () => expect(await toggle()).toBeChecked());
    expect(screen.queryByRole('alert', { name: '' })).toBeNull();
  });
});

describe('AI access page: the warning', () => {
  it.each([false, true])(
    'says what a connected assistant can use, whether the access is on (%s) or off',
    async (mcpEnabled) => {
      installSettingsApi({ settings: settings({ mcpEnabled }) });
      await openAiAccess();

      const warning = document.querySelector('[data-slot="alert"]');
      expect(warning).toHaveAttribute('data-variant', 'warning');
      expect(warning).toHaveTextContent(
        'A connected assistant can use every session and read every secret, including passwords and card numbers.',
      );
      expect(warning).toHaveTextContent(
        'Connect only assistants you trust. The address only works on this computer, but any program running here can use it while AI access is on.',
      );
    },
  );

  it('is part of the page, not an announcement made as it loads', async () => {
    installSettingsApi();
    await openAiAccess();
    const warning = document.querySelector('[data-slot="alert"]');
    expect(warning).not.toHaveAttribute('role', 'alert');
  });
});

describe('AI access page: while AI access is off', () => {
  it('shows only the switch, the warning and what switching it on does', async () => {
    installSettingsApi();
    const { control } = await openAiAccess();

    expect(control).not.toBeChecked();
    expect(screen.getByText(WHAT_ON_DOES)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="alert"]')).toHaveTextContent(
      /read every secret/,
    );
    expectNoExplanation();
    // The one section of the page there is, with its heading.
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent)
        .filter((name) => name !== 'Settings'),
    ).toEqual(['AI assistants']);
  });

  it('puts what switching it on does after the warning, in the same section', async () => {
    installSettingsApi();
    await openAiAccess();

    const warning = document.querySelector('[data-slot="alert"]');
    const line = screen.getByText(WHAT_ON_DOES);
    expect(
      (warning?.compareDocumentPosition(line) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(line.closest('section')).toBe(warning?.closest('section'));
  });
});

describe('AI access page: while AI access is on', () => {
  it('shows how to connect and the tools, below the switch, and no longer what switching it on does', async () => {
    installSettingsApi({ settings: settings({ mcpEnabled: true }) });
    const { control } = await openAiAccess();
    await waitFor(() => expect(control).toBeChecked());

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Connect an assistant',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'What assistants can do' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "An assistant can do everything you can do in Session Manager, except switch AI access on or off. You can watch it work in a session's page and take over at any time.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Overview and settings')).toBeInTheDocument();
    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add/)).toBeInTheDocument();
    expect(screen.queryByText(WHAT_ON_DOES)).toBeNull();
    // The warning stands.
    expect(document.querySelector('[data-slot="alert"]')).toBeInTheDocument();
  });

  it('has one h1 and no heading level skipped, off and on', async () => {
    installSettingsApi();
    const off = await openAiAccess();
    const levels = () =>
      screen
        .getAllByRole('heading')
        .map((heading) => Number(heading.tagName.slice(1)));
    expect(levels().filter((level) => level === 1)).toHaveLength(1);
    expect(Math.max(...levels())).toBe(2);

    await off.user.click(off.control);
    await screen.findByRole('heading', { name: 'Connect an assistant' });
    expect(levels().filter((level) => level === 1)).toHaveLength(1);
    expect(Math.max(...levels())).toBe(2);
  });
});

describe('AI access page: the explanation follows the saved value', () => {
  it('appears once AI access is switched on, and goes when it is switched off', async () => {
    installSettingsApi();
    const { user, control } = await openAiAccess();
    expectNoExplanation();

    await user.click(control);
    expect(
      await screen.findByRole('heading', { name: 'Connect an assistant' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(WHAT_ON_DOES)).toBeNull();

    await user.click(control);
    await waitFor(() => expect(connectHeading()).toBeNull());
    expectNoExplanation();
    expect(screen.getByText(WHAT_ON_DOES)).toBeInTheDocument();
  });

  it('waits for the server: the switch moves at once, the explanation when the change is saved', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let stored = settings();
    installFakeApi({
      'GET /settings': () => stored,
      'GET /meta': meta(),
      'PATCH /settings': async () => {
        await gate;
        stored = settings({ mcpEnabled: true });
        return stored;
      },
    });
    const { user, control } = await openAiAccess();

    await user.click(control);
    await waitFor(() => expect(control).toBeChecked());
    expect(control).toHaveAttribute('aria-busy', 'true');
    // Not saved yet: the page does not claim it is on.
    expectNoExplanation();

    await act(async () => {
      release();
      await gate;
    });
    expect(
      await screen.findByRole('heading', { name: 'Connect an assistant' }),
    ).toBeInTheDocument();
  });

  it('never shows it for a switch the server refused', async () => {
    installFakeApi({
      'GET /settings': settings(),
      'GET /meta': meta(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { user, control } = await openAiAccess();

    await user.click(control);

    await screen.findByText('This session is busy. Try again in a moment.');
    await waitFor(() => expect(control).not.toBeChecked());
    expectNoExplanation();
    expect(screen.getByText(WHAT_ON_DOES)).toBeInTheDocument();
  });

  it('follows a change made somewhere else once the settings are read again', async () => {
    const { server } = installSettingsApi();
    const { control, queryClient } = await openAiAccess();
    expectNoExplanation();

    server.settings = settings({ mcpEnabled: true });
    await act(() => queryClient.invalidateQueries({ queryKey: ['settings'] }));
    expect(
      await screen.findByRole('heading', { name: 'Connect an assistant' }),
    ).toBeInTheDocument();
    expect(control).toBeChecked();

    server.settings = settings({ mcpEnabled: false });
    await act(() => queryClient.invalidateQueries({ queryKey: ['settings'] }));
    await waitFor(() => expect(connectHeading()).toBeNull());
    expect(control).not.toBeChecked();
    expect(screen.getByText(WHAT_ON_DOES)).toBeInTheDocument();
  });

  it('follows a change made somewhere else when the window is back in front', async () => {
    const { server } = installSettingsApi();
    await openAiAccess();

    server.settings = settings({ mcpEnabled: true });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(
      await screen.findByRole('heading', { name: 'Connect an assistant' }),
    ).toBeInTheDocument();
  });
});

describe('AI access page in German', () => {
  it('says in German what switching it on does, and nothing more while it is off', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSettingsApi();
    renderSettings({ at: '/settings/ai-access' });

    expect(
      await screen.findByRole('switch', {
        name: 'Verbindungen von KI-Assistenten erlauben',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'KI-Zugriff' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ein verbundener Assistent kann jede Sitzung nutzen/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Schalte den KI-Zugriff ein, um zu sehen, wie du Session Manager einem Assistenten hinzufügst.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Assistenten verbinden')).toBeNull();
    expect(screen.queryByText(/Tools$/)).toBeNull();
  });

  it('reads in German once it is on, the plural counts of the tool groups included', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSettingsApi({ settings: settings({ mcpEnabled: true }) });
    renderSettings({ at: '/settings/ai-access' });

    expect(
      await screen.findByRole('heading', { name: 'Assistenten verbinden' }),
    ).toBeInTheDocument();
    expect(screen.getByText('17 Tools')).toBeInTheDocument();
    expect(screen.getByText('Was Assistenten tun können')).toBeInTheDocument();
  });

  it('says in French what switching it on does', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    installSettingsApi();
    renderSettings({ at: '/settings/ai-access' });

    expect(
      await screen.findByRole('switch', {
        name: 'Autoriser les assistants IA à se connecter',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Active l'accès IA pour voir comment ajouter Session Manager à un assistant.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Connecter un assistant')).toBeNull();
  });

  it('words a failed switch in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installFakeApi({
      'GET /settings': settings(),
      'GET /meta': meta(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { user } = renderSettings({ at: '/settings/ai-access' });

    await user.click(
      await screen.findByRole('switch', {
        name: 'Verbindungen von KI-Assistenten erlauben',
      }),
    );

    await screen.findByText(
      'Diese Sitzung ist gerade beschäftigt. Versuche es gleich noch einmal.',
    );
    expect(failureToasts()[0]).toMatchObject({
      title: 'KI-Zugriff konnte nicht geändert werden',
    });
  });
});

describe('AI access page: accessibility', () => {
  it('has no violations loaded off, loaded on, loading and failed', async () => {
    installSettingsApi();
    const off = await openAiAccess();
    await checkAccessibility(off);
    await off.user.click(off.control);
    await waitFor(() => expect(off.control).toBeChecked());
    await screen.findByRole('heading', { name: 'Connect an assistant' });
    await checkAccessibility(off);
    off.unmount();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /settings': async () => {
        await gate;
        return settings();
      },
      'GET /meta': meta(),
    });
    const loading = renderSettings({ at: '/settings/ai-access' });
    await screen.findByRole('status', { name: 'Loading content' });
    await checkAccessibility(loading);
    await act(async () => {
      release();
      await gate;
    });
    loading.unmount();

    installFakeApi({
      'GET /settings': failure(503, 'network'),
      'GET /meta': meta(),
    });
    const failed = renderSettings({ at: '/settings/ai-access' });
    await screen.findByRole('alert');
    await checkAccessibility(failed);
  });

  it('has no violations on a phone while it is off', async () => {
    installSettingsApi();
    const view = await openAiAccess('phone');
    expect(screen.getByText(WHAT_ON_DOES)).toBeInTheDocument();
    await checkAccessibility(view);
  });

  it('has no violations on a phone, with a tool group open', async () => {
    installSettingsApi({ settings: settings({ mcpEnabled: true }) });
    const view = await openAiAccess('phone');
    await view.user.click(await screen.findByText('Secrets and notes'));
    await checkAccessibility(view);
  });
});
