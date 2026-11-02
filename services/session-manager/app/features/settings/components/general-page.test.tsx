import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const { recordToasts } = await import('@/tests/utils/toast-recorder');
  return recordToasts(
    await importOriginal<typeof import('@tale/ui/use-toast')>(),
  );
});

import { queryKeys } from '@/app/lib/api/keys';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { answer, failure, installFakeApi } from '@/tests/utils/fake-api';
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

const REFUSAL =
  'The start page must be a web address, for example https://www.google.com.';

const field = () => screen.findByRole('textbox', { name: 'Start page' });
// After a save the button says Saved for a moment.
const save = () => screen.getByRole('button', { name: /^Saved?$/ });
const discard = () => screen.getByRole('button', { name: 'Discard' });

/** The page, once the start page field has its value. */
async function openGeneral(viewport: 'desktop' | 'phone' = 'desktop') {
  const view = renderSettings({ at: '/settings/general', viewport });
  const input = await screen.findByRole<HTMLInputElement>('textbox', {
    name: 'Start page',
  });
  await waitFor(() => expect(input.value).not.toBe(''));
  return { ...view, input };
}

describe('General page: the start page', () => {
  it('shows the saved address, what the setting does, and the default as the placeholder', async () => {
    installSettingsApi({
      settings: settings({ startPage: 'https://duckduckgo.com' }),
    });
    const { input } = await openGeneral();

    expect(input).toHaveValue('https://duckduckgo.com');
    expect(input).toHaveAttribute('placeholder', 'https://www.google.com');
    expect(input).toHaveAccessibleDescription(
      /New sessions open this page, and so does a session whose last tab you closed\. A session you stop keeps its tabs\./,
    );
    expect(input).toHaveAccessibleDescription(
      /Leave blank to use the default\./,
    );
  });

  it('puts the setting under a New sessions heading, below the page title', async () => {
    installSettingsApi();
    await openGeneral();
    expect(
      screen.getByRole('heading', { level: 2, name: 'New sessions' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'General',
    );
  });

  it('masks the field in place while the settings load, with Save and Discard waiting', async () => {
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
    renderSettings({ at: '/settings/general' });

    await screen.findAllByRole('status', { name: 'Loading content' });
    expect(screen.queryByRole('textbox', { name: 'Start page' })).toBeNull();
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();
    // What the field is for is there while it loads.
    expect(
      screen.getByText(/New sessions open this page, and so does a session/),
    ).toBeInTheDocument();

    await act(async () => {
      release();
      await gate;
    });
    expect(await field()).toHaveValue('https://www.google.com');
    expect(save()).toBeDisabled();
  });

  it('keeps Save and Discard disabled until the address is changed', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();

    await user.type(input, '/search');
    expect(save()).toBeEnabled();
    expect(discard()).toBeEnabled();

    await user.clear(input);
    await user.type(input, 'https://www.google.com');
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();
  });

  it('saves the draft, shows the address the server completed and flashes Saved', async () => {
    const { api } = installSettingsApi();
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.type(input, '  duckduckgo.com ');
    await user.click(save());

    await screen.findByRole('button', { name: 'Saved' });
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      startPage: 'duckduckgo.com',
    });
    expect(input).toHaveValue('https://duckduckgo.com');
    expect(discard()).toBeDisabled();
    expect(raised.filter((toast) => toast.title !== undefined)).toHaveLength(0);
  });

  it('saves with Enter in the field, and does not when nothing changed', async () => {
    const { api } = installSettingsApi();
    const { user, input } = await openGeneral();

    await user.click(input);
    await user.keyboard('{Enter}');
    expect(api.callsTo('PATCH /settings')).toHaveLength(0);

    await user.type(input, '/search{Enter}');
    await waitFor(() => expect(save()).toBeDisabled());
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      startPage: 'https://www.google.com/search',
    });
    expect(input).toHaveValue('https://www.google.com/search');
  });

  it('saves with Ctrl+S from the field', async () => {
    const { api } = installSettingsApi();
    const { user, input } = await openGeneral();

    await user.type(input, '/search');
    await user.keyboard('{Control>}s{/Control}');

    await screen.findByRole('button', { name: 'Saved' });
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
  });

  it('saves a blank field as the default, which the field then shows', async () => {
    const { api } = installSettingsApi({
      settings: settings({ startPage: 'https://duckduckgo.com' }),
    });
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.click(save());

    await screen.findByRole('button', { name: 'Saved' });
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({ startPage: '' });
    expect(input).toHaveValue('https://www.google.com');
  });

  it('discards the draft and returns to the saved address', async () => {
    installSettingsApi({
      settings: settings({ startPage: 'https://duckduckgo.com' }),
    });
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.type(input, 'https://example.org');
    await user.click(discard());

    expect(input).toHaveValue('https://duckduckgo.com');
    expect(save()).toBeDisabled();
    expect(discard()).toBeDisabled();
  });

  it('shows the backend’s refusal beside the field, keeps the draft and raises no toast', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.type(input, 'nonsense words');
    await user.click(save());

    await waitFor(() => expect(input).toBeInvalid());
    expect(input).toHaveAccessibleErrorMessage(REFUSAL);
    expect(input).toHaveValue('nonsense words');
    await waitFor(() => expect(save()).toBeEnabled());
    expect(failureToasts()).toHaveLength(0);
  });

  // The button that was pressed is off while the save runs, and the keyboard
  // goes with it: it comes back to the field that has to be repaired.
  it('puts the keyboard in the field when the backend refused the address, also when Save was pressed with the keyboard', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    await user.clear(input);
    await user.type(input, 'nonsense words');
    save().focus();
    expect(save()).toHaveFocus();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(input).toBeInvalid());
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('keeps the keyboard in the field when Enter in it saved a refused address', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    await user.clear(input);
    await user.type(input, 'nonsense words');

    await user.keyboard('{Enter}');

    await waitFor(() => expect(input).toBeInvalid());
    expect(input).toHaveFocus();
  });

  it('does not claim the address was saved when the backend refused it', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.type(input, 'nonsense words');
    await user.click(save());
    await waitFor(() => expect(input).toBeInvalid());
    await waitFor(() => expect(save()).toBeEnabled());

    // Saved is what the button says for a moment after a save that went through.
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
    expect(save()).toHaveAccessibleName('Save');
    expect(discard()).toBeEnabled();
  });

  it('clears the refusal as soon as the address is edited', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    await user.clear(input);
    await user.type(input, 'nonsense words');
    await user.click(save());
    await waitFor(() => expect(input).toBeInvalid());

    await user.type(input, '.com');

    expect(input).toBeValid();
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('keeps the draft and tells a failed save once, in the person’s language', async () => {
    const api = installFakeApi({
      'GET /settings': settings(),
      'GET /meta': meta(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { user, input } = await openGeneral();

    await user.type(input, '/search');
    await user.click(save());

    await screen.findByText('This session is busy. Try again in a moment.');
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
    expect(failureToasts()).toHaveLength(1);
    expect(failureToasts()[0]).toMatchObject({
      title: 'Save',
      description: 'This session is busy. Try again in a moment.',
    });
    expect(input).toHaveValue('https://www.google.com/search');
    expect(input).toBeValid();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('tells a failed save made with Enter once as well', async () => {
    installFakeApi({
      'GET /settings': settings(),
      'GET /meta': meta(),
      'PATCH /settings': failure(409, 'session_busy'),
    });
    const { user, input } = await openGeneral();

    await user.type(input, '/search{Enter}');

    await screen.findByText('This session is busy. Try again in a moment.');
    expect(failureToasts()).toHaveLength(1);
    expect(input).toHaveValue('https://www.google.com/search');
  });

  it('offers the default when the address is another one, and puts it into the field', async () => {
    const { api } = installSettingsApi({
      settings: settings({ startPage: 'https://duckduckgo.com' }),
    });
    const { user, input } = await openGeneral();

    await user.click(
      screen.getByRole('button', {
        name: 'Use default start page (https://www.google.com)',
      }),
    );

    expect(input).toHaveValue('https://www.google.com');
    // The focus stays where the person was: the button is gone.
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: /Use default start page/ }),
    ).toBeNull();
    expect(save()).toBeEnabled();
    await user.click(save());
    await screen.findByRole('button', { name: 'Saved' });
    expect(api.callsTo('PATCH /settings')[0]?.body).toEqual({
      startPage: 'https://www.google.com',
    });
  });

  it('does not offer the default when the field is the default or blank', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    expect(
      screen.queryByRole('button', { name: /Use default start page/ }),
    ).toBeNull();

    await user.clear(input);
    expect(
      screen.queryByRole('button', { name: /Use default start page/ }),
    ).toBeNull();
  });

  it('says the address was changed elsewhere and lets the person take it or keep editing', async () => {
    const { server } = installSettingsApi();
    const { user, input, queryClient } = await openGeneral();
    await user.type(input, '/mine');

    server.settings = settings({ startPage: 'https://bing.com' });
    await act(() =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    );

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'The start page was changed somewhere else, for example by an AI assistant.',
    );
    expect(input).toHaveValue('https://www.google.com/mine');

    await user.click(
      within(notice).getByRole('button', { name: 'Keep editing' }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(input).toHaveValue('https://www.google.com/mine');
  });

  it('shows the new address when the person takes the change made elsewhere', async () => {
    const { server } = installSettingsApi();
    const { user, input, queryClient } = await openGeneral();
    await user.type(input, '/mine');
    server.settings = settings({ startPage: 'https://bing.com' });
    await act(() =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    );

    await user.click(
      await screen.findByRole('button', { name: 'Show the saved address' }),
    );

    expect(input).toHaveValue('https://bing.com');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save()).toBeDisabled();
  });

  it('reads on with a retry when the settings cannot be loaded', async () => {
    let healthy = false;
    installFakeApi({
      'GET /settings': () =>
        healthy ? settings() : failure(403, 'forbidden_host'),
      'GET /meta': meta(),
    });
    const { user } = renderSettings({ at: '/settings/general' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't load the settings. Open Session Manager at 127.0.0.1 or localhost.",
    );
    expect(screen.queryByRole('textbox', { name: 'Start page' })).toBeNull();

    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await field()).toHaveValue('https://www.google.com');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps showing the address when a later read fails, for the banner already says so', async () => {
    const { server } = installSettingsApi();
    const { input, queryClient } = await openGeneral();
    server.settings = settings();
    installFakeApi({
      'GET /settings': failure(503, 'network'),
      'GET /meta': meta(),
    });

    await act(() =>
      queryClient.invalidateQueries({ queryKey: queryKeys.settings }),
    );

    expect(input).toHaveValue('https://www.google.com');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('has no accessibility violations loading, loaded, with a refusal and failed', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /settings': async () => {
        await gate;
        return settings();
      },
      'GET /meta': async () => {
        await gate;
        return meta();
      },
    });
    const view = renderSettings({ at: '/settings/general' });
    await screen.findAllByRole('status', { name: 'Loading content' });
    await checkAccessibility(view);

    await act(async () => {
      release();
      await gate;
    });
    const input = await field();
    await checkAccessibility(view);

    installSettingsApi();
    await view.user.clear(input);
    await view.user.type(input, 'nonsense words');
    await view.user.click(save());
    await waitFor(() => expect(input).toBeInvalid());
    await checkAccessibility(view);
    view.unmount();

    installFakeApi({
      'GET /settings': failure(503, 'network'),
      'GET /meta': meta(),
    });
    const failed = renderSettings({ at: '/settings/general' });
    await screen.findByRole('alert');
    await checkAccessibility(failed);
  });
});

describe('General page on a phone', () => {
  it('puts Save and Discard in a dock, and saves from there', async () => {
    const { api } = installSettingsApi();
    const { user, input } = await openGeneral('phone');

    await user.type(input, '/search');
    // One cluster only: the header's copy is for a computer.
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    await user.click(save());

    await screen.findByRole('button', { name: 'Saved' });
    expect(api.callsTo('PATCH /settings')).toHaveLength(1);
  });
});

describe('General page in German', () => {
  it('reads in German, with the tool count of a plural written out', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSettingsApi();
    renderSettings({ at: '/settings/general' });

    const input = await screen.findByRole('textbox', { name: 'Startseite' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Allgemein' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Neue Sitzungen' }),
    ).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(
      /Neue Sitzungen öffnen diese Seite/,
    );
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Info' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Browser installiert')).toBeInTheDocument();
  });

  it('words the backend’s refusal in German, beside the field', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSettingsApi();
    const { user } = renderSettings({ at: '/settings/general' });
    const input = await screen.findByRole('textbox', { name: 'Startseite' });
    await waitFor(() => expect(input).toHaveValue('https://www.google.com'));

    await user.clear(input);
    await user.type(input, 'kein gültiger wert');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(input).toBeInvalid());
    expect(input).toHaveAccessibleErrorMessage(
      'Die Startseite muss eine Webadresse sein, zum Beispiel https://www.google.com.',
    );
  });
});

describe('General page: leaving with a draft', () => {
  it('asks before leaving, and keeps the draft when the person stays', async () => {
    installSettingsApi();
    const { user, input, router } = await openGeneral();
    await user.type(input, '/mine');

    await user.click(screen.getByRole('link', { name: 'Appearance' }));

    const dialog = await screen.findByRole('dialog', {
      name: 'Unsaved changes',
    });
    expect(router.state.location.pathname).toBe('/settings/general');
    await user.click(
      within(dialog).getByRole('button', { name: 'Keep editing' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/settings/general');
    expect(screen.getByRole('textbox', { name: 'Start page' })).toHaveValue(
      'https://www.google.com/mine',
    );
  });

  it('leaves and drops the draft when the person says so', async () => {
    const { api } = installSettingsApi();
    const { user, input, router } = await openGeneral();
    await user.type(input, '/mine');

    await user.click(screen.getByRole('link', { name: 'AI access' }));
    await user.click(
      await screen.findByRole('button', { name: 'Discard & Leave' }),
    );

    await screen.findByRole('heading', { level: 1, name: 'AI access' });
    expect(router.state.location.pathname).toBe('/settings/ai-access');
    expect(api.callsTo('PATCH /settings')).toHaveLength(0);
    // The draft is gone: coming back reads the saved address.
    await user.click(screen.getByRole('link', { name: 'General' }));
    expect(await field()).toHaveValue('https://www.google.com');
  });

  it('also asks before the rail takes the person to another section', async () => {
    installSettingsApi();
    const { user, input, router } = await openGeneral();
    await user.type(input, '/mine');

    await act(async () => {
      void router.navigate({ to: '/sessions' });
    });

    expect(
      await screen.findByRole('dialog', { name: 'Unsaved changes' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/general');
  });

  it('lets the person leave freely once the draft is saved or discarded', async () => {
    installSettingsApi();
    const { user, input } = await openGeneral();
    await user.type(input, '/mine');
    await user.click(save());
    await screen.findByRole('button', { name: 'Saved' });

    await user.click(screen.getByRole('link', { name: 'Appearance' }));

    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not ask when nothing was changed', async () => {
    installSettingsApi();
    const { user } = await openGeneral();

    await user.click(screen.getByRole('link', { name: 'Appearance' }));

    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('General page: answering', () => {
  it('survives a save answer that is the same address', async () => {
    installFakeApi({
      'GET /settings': settings({ startPage: 'https://duckduckgo.com' }),
      'GET /meta': meta(),
      'PATCH /settings': answer({
        body: settings({ startPage: 'https://duckduckgo.com' }),
      }),
    });
    const { user, input } = await openGeneral();

    await user.clear(input);
    await user.type(input, 'duckduckgo.com');
    await user.click(save());

    await screen.findByRole('button', { name: 'Saved' });
    expect(input).toHaveValue('https://duckduckgo.com');
    expect(save()).toBeDisabled();
  });
});
