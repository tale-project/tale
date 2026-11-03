import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, proxy } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderInShell } from '@/tests/utils/render';

import { CheckAllButton } from './check-all-button';

afterEach(resetLanguage);

const button = () => screen.getByRole('button', { name: 'Check all proxies' });

function serve(counts: Partial<ReturnType<typeof meta>['counts']>) {
  return installFakeApi({
    'GET /meta': () => meta({ counts }),
    'POST /proxies/check-all': [proxy()],
  });
}

describe('CheckAllButton', () => {
  it('starts a check of every proxy and says so', async () => {
    const api = serve({ proxies: 3, checkingProxies: 0 });
    const { user } = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());

    await user.click(button());

    await waitFor(() =>
      expect(api.callsTo('POST /proxies/check-all')).toHaveLength(1),
    );
    // Started, not finished: no ellipsis in a notice's title.
    expect(
      await screen.findByText('Check of all proxies started'),
    ).toBeVisible();
  });

  it('says what it does to whoever rests on it, in words that add to its name', async () => {
    serve({ proxies: 3, checkingProxies: 0 });
    const { user } = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());

    await user.tab();

    expect(button()).toHaveFocus();
    expect(
      await screen.findByRole('tooltip', {
        name: 'Starts a new check of every proxy. The results appear in the table.',
      }),
    ).toBeVisible();
  });

  it('waits for the counts before it offers anything', () => {
    serve({ proxies: 3 });
    renderInShell(<CheckAllButton />);

    // Not offered yet: the proxies are only not counted.
    expect(button()).toBeDisabled();
  });

  it('is busy while the request runs', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    installFakeApi({
      'GET /meta': () => meta({ counts: { proxies: 3 } }),
      'POST /proxies/check-all': async () => {
        await gate;
        return [proxy()];
      },
    });
    const { user } = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());

    await user.click(button());

    await waitFor(() => expect(button()).toHaveAttribute('aria-busy', 'true'));
    release();
    await waitFor(() => expect(button()).not.toHaveAttribute('aria-busy'));
  });

  it('has nothing to do while every proxy is being checked', async () => {
    const api = serve({ proxies: 3, checkingProxies: 3 });
    const { user } = renderInShell(<CheckAllButton />);

    await waitFor(() =>
      expect(button()).toHaveAttribute('aria-disabled', 'true'),
    );
    await user.tab();
    expect(
      await screen.findByRole('tooltip', {
        name: 'Every proxy is already being checked.',
      }),
    ).toBeVisible();
    await user.click(button());
    expect(api.callsTo('POST /proxies/check-all')).toHaveLength(0);
  });

  it('keeps the focus when the check it started makes it unavailable', async () => {
    const api = serve({ proxies: 3, checkingProxies: 0 });
    const { user } = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());
    await user.tab();
    expect(button()).toHaveFocus();

    api.on('GET /meta', () =>
      meta({ counts: { proxies: 3, checkingProxies: 3 } }),
    );
    await user.keyboard('{Enter}');

    await waitFor(() =>
      expect(button()).toHaveAttribute('aria-disabled', 'true'),
    );
    expect(button()).toHaveFocus();
  });

  it('tells a failure once, as a toast', async () => {
    installFakeApi({
      'GET /meta': () => meta({ counts: { proxies: 3 } }),
      'POST /proxies/check-all': failure(
        500,
        'internal',
        'The server is on fire',
      ),
    });
    const { user } = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());

    await user.click(button());

    expect(await screen.findByText("Couldn't check the proxies")).toBeVisible();
    // A code the app has no words for: not the backend's own English.
    expect(screen.getByText('Something went wrong. Try again.')).toBeVisible();
    expect(screen.queryByText('The server is on fire')).not.toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    serve({ proxies: 3 });
    renderInShell(<CheckAllButton />);

    expect(
      screen.getByRole('button', { name: 'Alle Proxies prüfen' }),
    ).toBeVisible();
  });

  it('has no accessibility violations, enabled and busy', async () => {
    serve({ proxies: 3, checkingProxies: 3 });
    const view = renderInShell(<CheckAllButton />);
    await waitFor(() =>
      expect(button()).toHaveAttribute('aria-disabled', 'true'),
    );
    await checkAccessibility(view);

    view.unmount();
    serve({ proxies: 3 });
    const enabled = renderInShell(<CheckAllButton />);
    await waitFor(() => expect(button()).toBeEnabled());
    await checkAccessibility(enabled);
  });
});
