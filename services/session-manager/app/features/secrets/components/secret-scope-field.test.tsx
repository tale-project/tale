import { LOCALE_STORAGE_KEY } from '@tale/ui/i18n/detect-locale';
import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { renderApp } from '@/tests/utils/render';
import { installSecretsApi, sessionList } from '@/tests/utils/secrets-api';

import { SecretScopeField } from './secret-scope-field';

/** The field with its own state, as a form holds it. */
function Held(
  props: Partial<React.ComponentProps<typeof SecretScopeField>> & {
    initial?: string;
  },
) {
  const { initial = 'global', ...rest } = props;
  const [value, setValue] = useState(initial);
  return <SecretScopeField value={value} onValueChange={setValue} {...rest} />;
}

const button = () => screen.getByRole('button', { name: 'Available to' });

describe('SecretScopeField', () => {
  it('is a labelled field that shows who the secret is for', async () => {
    installSecretsApi();
    renderApp(<Held initial="global" />);
    expect(button()).toHaveTextContent('Every session');
    expect(screen.getByText('Available to')).toBeInTheDocument();
  });

  it('offers every session or one of them, the sessions by name as numbers read', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    await user.click(button());

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Every session',
      'Session "0001"',
      'Session "0002"',
      'Session "0003"',
      'Session "0013"',
      'Session "0014"',
      'Session "Shop EU"',
    ]);
  });

  it('chooses a session by its id', async () => {
    installSecretsApi();
    const onValueChange = vi.fn();
    const { user } = renderApp(
      <SecretScopeField value="global" onValueChange={onValueChange} />,
    );
    await user.click(button());
    await user.click(
      await screen.findByRole('option', { name: 'Session "0003"' }),
    );
    expect(onValueChange).toHaveBeenCalledWith('3');
  });

  it('shows the choice once it is made', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    await user.click(button());
    await user.click(
      await screen.findByRole('option', { name: 'Session "Shop EU"' }),
    );
    expect(button()).toHaveTextContent('Session "Shop EU"');
  });

  it('finds a session by typing, with the search named as what it searches', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    await user.click(button());
    await screen.findAllByRole('option');
    await user.type(
      screen.getByRole('combobox', { name: 'Search sessions' }),
      '001',
    );

    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Session "0001"', 'Session "0013"', 'Session "0014"']);
  });

  it('says so when no session matches', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    await user.click(button());
    await screen.findAllByRole('option');
    await user.type(
      screen.getByRole('combobox', { name: 'Search sessions' }),
      'zzz',
    );
    expect(screen.getByText('No sessions found')).toBeInTheDocument();
  });

  it('chooses with the keyboard alone', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    button().focus();
    await user.keyboard('{Enter}');
    await screen.findAllByRole('option');
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(button()).toHaveTextContent('Session "0002"');
    // The list closes and the focus is back on the field.
    await waitFor(() => expect(button()).toHaveFocus());
  });

  it('says that it lists only some sessions when the server has more than one request returns', async () => {
    installSecretsApi({ sessionsTotal: 730 });
    const { user } = renderApp(<Held />);
    await user.click(button());
    expect(
      await screen.findByText('Only the newest 6 of 730 sessions are listed.'),
    ).toBeInTheDocument();
  });

  it('groups the digits of the counts it names, as the language reads them', async () => {
    installSecretsApi({ sessionsTotal: 1234 });
    const { user } = renderApp(<Held />);
    await user.click(button());
    expect(
      await screen.findByText(
        'Only the newest 6 of 1,234 sessions are listed.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing about a cap when every session is listed', async () => {
    installSecretsApi();
    const { user } = renderApp(<Held />);
    await user.click(button());
    await screen.findAllByRole('option');
    expect(screen.queryByText(/are listed/)).not.toBeInTheDocument();
  });

  it('offers the session the secret is for even when it is beyond the first sessions', async () => {
    installSecretsApi({ sessions: sessionList().slice(0, 2) });
    const { user } = renderApp(
      <Held knownSessions={[{ id: 99, name: 'Archive' }]} />,
    );
    await user.click(button());
    await screen.findByRole('option', { name: 'Session "0014"' });
    expect(
      screen.getByRole('option', { name: 'Session "Archive"' }),
    ).toBeInTheDocument();
  });

  it('keeps a chosen session that is not listed anywhere, by its number', async () => {
    installSecretsApi();
    renderApp(<Held initial="77" />);
    expect(button()).toHaveTextContent('Session "77"');
  });

  it('still offers every session when the sessions cannot be read', async () => {
    installFakeApi({ 'GET /sessions': failure(500, 'internal') });
    const { user } = renderApp(
      <Held knownSessions={[{ id: 5, name: 'Known' }]} />,
    );
    await user.click(button());
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Every session',
      'Session "Known"',
    ]);
  });

  it('says the sessions are on their way, not that there are none, while a search waits for them', async () => {
    installFakeApi({ 'GET /sessions': () => new Promise(() => {}) });
    const { user } = renderApp(<Held />);
    await user.click(button());
    await user.type(
      await screen.findByRole('combobox', { name: 'Search sessions' }),
      'shop',
    );
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
    expect(screen.queryByText('No sessions found')).not.toBeInTheDocument();
  });

  it('says the sessions could not be loaded, not that there are none, when a search finds nothing', async () => {
    installFakeApi({ 'GET /sessions': failure(500, 'internal') });
    const { user } = renderApp(<Held />);
    await user.click(button());
    await user.type(
      await screen.findByRole('combobox', { name: 'Search sessions' }),
      'shop',
    );
    expect(
      await screen.findByText("Couldn't load the sessions."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No sessions found')).not.toBeInTheDocument();
  });

  it('has no accessibility violations, closed and open', async () => {
    installSecretsApi();
    const view = renderApp(<Held />);
    await checkAccessibility(view);
    await view.user.click(button());
    await screen.findAllByRole('option');
    await waitFor(() =>
      expect(
        within(document.body).getAllByRole('option').length,
      ).toBeGreaterThan(0),
    );
    await checkAccessibility(document.body);
  });
});

describe('SecretScopeField in German', () => {
  afterEach(() => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
  });

  it('groups them with the dot in German', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'de');
    installSecretsApi({ sessionsTotal: 1234 });
    const { user } = renderApp(<Held />);
    await user.click(
      await screen.findByRole('button', { name: 'Verfügbar für' }),
    );
    expect(
      await screen.findByText(
        'Aufgelistet sind nur die neuesten 6 von 1.234 Sitzungen.',
      ),
    ).toBeInTheDocument();
  });
});
