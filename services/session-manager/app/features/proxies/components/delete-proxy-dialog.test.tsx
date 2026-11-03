import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { sessionRef } from '@/tests/utils/fixtures';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderInShell } from '@/tests/utils/render';

import {
  DeleteProxyDialog,
  type DeleteProxyDialogProps,
} from './delete-proxy-dialog';

afterEach(resetLanguage);

function renderDialog(props: Partial<DeleteProxyDialogProps> = {}) {
  const onOpenChange = vi.fn();
  const onDelete = vi.fn();
  const view = renderInShell(
    <DeleteProxyDialog
      open
      onOpenChange={onOpenChange}
      address="198.51.100.4:8080"
      step={{ kind: 'plain' }}
      isDeleting={false}
      onDelete={onDelete}
      {...props}
    />,
  );
  return { ...view, onOpenChange, onDelete };
}

describe('DeleteProxyDialog', () => {
  describe('a proxy nobody has', () => {
    it('asks, and says it only leaves the pool', async () => {
      const { user, onDelete, onOpenChange } = renderDialog();

      expect(
        screen.getByRole('dialog', { name: 'Delete proxy?' }),
      ).toBeVisible();
      expect(
        screen.getByText('198.51.100.4:8080 is removed from the pool.'),
      ).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Delete proxy' }));
      expect(onDelete).toHaveBeenCalledOnce();
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('can be cancelled, by the button and by Escape', async () => {
      const { user, onDelete, onOpenChange } = renderDialog();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledTimes(2);
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('puts Cancel before the destructive action', () => {
      renderDialog();
      const buttons = screen
        .getAllByRole('button')
        .map((button) => button.textContent);
      expect(buttons.indexOf('Cancel')).toBeLessThan(
        buttons.indexOf('Delete proxy'),
      );
    });

    it('speaks German', async () => {
      await showLanguage('de');
      renderDialog();
      expect(
        screen.getByRole('dialog', { name: 'Proxy löschen?' }),
      ).toBeVisible();
      expect(
        screen.getByText('198.51.100.4:8080 wird aus dem Pool entfernt.'),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
    });
  });

  describe('a proxy a stopped session has', () => {
    const session = sessionRef({ id: 4, name: 'work', status: 'stopped' });

    it('says the session gets another proxy on its next start, and asks again', async () => {
      const { user, onDelete } = renderDialog({
        step: { kind: 'in-use', session },
      });

      expect(
        screen.getByRole('dialog', { name: 'Delete a proxy in use?' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'The session "work" uses 198.51.100.4:8080. If you delete the proxy, the session gets another one on its next start.',
        ),
      ).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'Delete proxy' }));
      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('says it in the words of the app when the session is not named', () => {
      renderDialog({ step: { kind: 'in-use', session: null } });
      expect(
        screen.getByText(
          'A session uses this proxy. If you delete the proxy, the session gets another one on its next start.',
        ),
      ).toBeVisible();
    });

    it('speaks German and French', async () => {
      await showLanguage('de');
      const german = renderDialog({ step: { kind: 'in-use', session } });
      expect(
        screen.getByText(
          'Die Sitzung „work“ nutzt 198.51.100.4:8080. Wenn du ihn löschst, bekommt die Sitzung beim nächsten Start einen anderen.',
        ),
      ).toBeVisible();
      german.unmount();

      await showLanguage('fr');
      renderDialog({ step: { kind: 'in-use', session } });
      expect(
        screen.getByText(
          'La session « work » utilise 198.51.100.4:8080. Si tu le supprimes, la session en recevra un autre à son prochain démarrage.',
        ),
      ).toBeVisible();
    });
  });

  describe('a proxy a running session has', () => {
    const session = sessionRef({ id: 4, name: 'work', status: 'running' });

    it('says to stop the session first, with a way to it, and offers no deletion', async () => {
      const { user, onDelete, onOpenChange } = renderDialog({
        step: { kind: 'busy', session },
      });

      expect(
        screen.getByRole('dialog', { name: 'Stop the session first' }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'The session "work" is using 198.51.100.4:8080 right now. Stop the session, then delete the proxy.',
        ),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Delete proxy' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Open session' }),
      ).toHaveAttribute('href', '/sessions/4');

      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onDelete).not.toHaveBeenCalled();
    });

    it('says it in the words of the app, without a way to the session, when it is not named', () => {
      renderDialog({ step: { kind: 'busy', session: null } });
      expect(
        screen.getByText(
          'A session is using this proxy right now. Stop the session first.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('speaks German', async () => {
      await showLanguage('de');
      renderDialog({ step: { kind: 'busy', session } });
      expect(
        screen.getByRole('dialog', { name: 'Stoppe zuerst die Sitzung' }),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'Sitzung öffnen' }),
      ).toBeVisible();
    });
  });

  describe('while the proxy is deleted', () => {
    it('cannot be dismissed, and the action is busy', async () => {
      const { user, onOpenChange } = renderDialog({ isDeleting: true });

      expect(
        screen.getByRole('button', { name: 'Delete proxy' }),
      ).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a proxy nobody has', { kind: 'plain' }],
    [
      'a proxy a stopped session has',
      { kind: 'in-use', session: sessionRef() },
    ],
    [
      'a proxy a running session has',
      { kind: 'busy', session: sessionRef({ status: 'running' }) },
    ],
  ] as const)('has no accessibility violations (%s)', async (_case, step) => {
    renderDialog({ step });
    await checkAccessibility(document.body);
  });
});
