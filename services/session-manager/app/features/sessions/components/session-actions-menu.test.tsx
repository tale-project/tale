import { act, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POLL_FAST_MS } from '@/app/lib/polling';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi, list } from '@/tests/utils/fake-api';
import {
  meta,
  proxy,
  runningSession,
  secretSummary,
  session,
} from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { errorText } from '@/tests/utils/errors';
import { ToastList, shownToasts } from '@/tests/utils/toast-list';

import { useSession } from '../hooks/use-session';
import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionActionsMenu } from './session-actions-menu';

function renderMenu(row: Session = runningSession(), onDeleted = vi.fn()) {
  const view = renderApp(
    <ProxyFlowProvider>
      <SessionActionsMenu session={row} onDeleted={onDeleted} />
      <ToastList />
    </ProxyFlowProvider>,
  );
  return { ...view, onDeleted };
}

/** The menu button; a modal dialog hides it from the accessibility tree. */
const trigger = () =>
  screen.getByRole('button', { name: 'Actions for 0001', hidden: true });

async function openMenu(user: UserEvent) {
  await user.click(trigger());
  return screen.findByRole('menu');
}

async function choose(user: UserEvent, name: RegExp | string) {
  await openMenu(user);
  await user.click(screen.getByRole('menuitem', { name }));
}

/** The answers of a route, one after the other; the last one stays. */
function sequence<Answers extends unknown[]>(...answers: Answers) {
  let next = 0;
  return (): Answers[number] => answers[Math.min(next++, answers.length - 1)];
}

function noSecrets() {
  return { 'GET /secrets': list([]) };
}

beforeEach(() => {
  installFakeApi({ 'GET /meta': meta(), ...noSecrets() });
});

describe('SessionActionsMenu', () => {
  describe('the menu', () => {
    it('offers every action of a running session, its window first and Delete apart from the rest', async () => {
      const { user } = renderMenu(runningSession());
      const menu = await openMenu(user);
      const items = within(menu).getAllByRole('menuitem');

      expect(items).toHaveLength(6);
      [
        'Show window',
        'Rename',
        'Restart',
        'Rotate IP',
        'Check IP',
        'Delete',
      ].forEach((label, index) => {
        expect(items[index]).toHaveTextContent(new RegExp(`^${label}`));
        expect(items[index]).not.toHaveAttribute('aria-disabled', 'true');
      });
      expect(within(menu).getAllByRole('separator')).toHaveLength(2);
    });

    it('brings the window of a running session to the front', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        ...noSecrets(),
        'POST /sessions/:id/show': undefined,
      });
      const { user } = renderMenu(runningSession({ id: 4 }));
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Show window' }));
      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/show')).toHaveLength(1),
      );
      expect(api.callsTo('POST /sessions/:id/show')[0]?.path).toBe(
        '/sessions/4/show',
      );
    });

    it('says that a session that does not run has no window to show', async () => {
      const { user } = renderMenu(session());
      const menu = await openMenu(user);
      const item = within(menu).getByRole('menuitem', {
        name: /^Show window/,
      });
      expect(item).toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveTextContent('Only a running session has a window.');
    });

    it('explains what Rotate IP does', async () => {
      const { user } = renderMenu(runningSession());
      const menu = await openMenu(user);
      expect(
        within(menu).getByRole('menuitem', { name: /^Rotate IP/ }),
      ).toHaveTextContent('Switches to another working proxy.');
    });

    it('says why Restart and Check IP cannot be used on a stopped session', async () => {
      const { user } = renderMenu(session());
      const menu = await openMenu(user);

      const restart = within(menu).getByRole('menuitem', { name: /^Restart/ });
      expect(restart).toHaveAttribute('aria-disabled', 'true');
      expect(restart).toHaveTextContent(
        'Only a running session can be restarted.',
      );
      const check = within(menu).getByRole('menuitem', { name: /^Check IP/ });
      expect(check).toHaveAttribute('aria-disabled', 'true');
      expect(check).toHaveTextContent('Only a running session can be checked.');
      expect(
        within(menu).getByRole('menuitem', { name: /^Rotate IP/ }),
      ).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('says why a running session without a proxy cannot be checked', async () => {
      const { user } = renderMenu(runningSession({ proxy: null }));
      const menu = await openMenu(user);
      expect(
        within(menu).getByRole('menuitem', { name: /^Check IP/ }),
      ).toHaveTextContent('The session has no proxy.');
    });

    it('says why a busy session cannot rotate its IP', async () => {
      const { user } = renderMenu(session({ activity: 'assigning_proxy' }));
      const menu = await openMenu(user);
      const rotate = within(menu).getByRole('menuitem', { name: /^Rotate IP/ });
      expect(rotate).toHaveAttribute('aria-disabled', 'true');
      expect(rotate).toHaveTextContent(
        'Wait until the session has finished starting or stopping.',
      );
    });

    it('says why a busy running session cannot be restarted', async () => {
      const { user } = renderMenu(runningSession({ activity: 'launching' }));
      const menu = await openMenu(user);
      expect(
        within(menu).getByRole('menuitem', { name: /^Restart/ }),
      ).toHaveTextContent('The session is busy.');
    });

    it('does nothing when a disabled action is chosen', async () => {
      const api = installFakeApi({ 'GET /meta': meta() });
      const { user } = renderMenu(session());
      const menu = await openMenu(user);

      await user.click(
        within(menu).getByRole('menuitem', { name: /^Restart/ }),
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.calls.filter((call) => call.method === 'POST')).toEqual([]);
    });

    it('is named by the session, so each row has a menu of its own', () => {
      renderMenu(session({ name: 'Shop login' }));
      expect(
        screen.getByRole('button', { name: 'Actions for Shop login' }),
      ).toHaveAttribute('aria-haspopup', 'menu');
    });

    it('works with the keyboard alone: open, move, close, and focus comes back', async () => {
      const { user } = renderMenu(runningSession());
      await user.tab();
      expect(trigger()).toHaveFocus();

      await user.keyboard('{Enter}');
      const menu = await screen.findByRole('menu');
      await waitFor(() =>
        expect(
          within(menu).getByRole('menuitem', { name: 'Show window' }),
        ).toHaveFocus(),
      );
      await user.keyboard('{ArrowDown}');
      expect(
        within(menu).getByRole('menuitem', { name: 'Rename' }),
      ).toHaveFocus();
      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
      );
      expect(trigger()).toHaveFocus();
    });

    it('has no accessibility violations, open', async () => {
      const { user } = renderMenu(session());
      await checkAccessibility(await openMenu(user));
    });
  });

  describe('Rename', () => {
    it('opens a dialog with the current name', async () => {
      const { user } = renderMenu(runningSession());
      await openMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

      const dialog = await screen.findByRole('dialog', {
        name: 'Rename session',
      });
      expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue(
        '0001',
      );
      expect(
        within(dialog).getByRole('textbox', { name: /Name/ }),
      ).toHaveFocus();
      await checkAccessibility(dialog);
    });

    it('renames the session and closes', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': session({ name: 'Bank' }),
      });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.clear(field);
      await user.type(field, '  Bank  {Enter}');

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('PATCH /sessions/:id')[0]?.body).toEqual({
        name: 'Bank',
      });
      expect(trigger()).toHaveFocus();
    });

    it('closes without a request when the name is unchanged', async () => {
      const api = installFakeApi({ 'GET /meta': meta() });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      await screen.findByRole('dialog');

      await user.click(screen.getByRole('button', { name: 'Rename session' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('PATCH /sessions/:id')).toHaveLength(0);
    });

    it('asks for a name when it is blank, beside the field', async () => {
      const api = installFakeApi({ 'GET /meta': meta() });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.clear(field);
      await user.type(field, '   {Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        errorText('invalid_name'),
      );
      expect(field).toBeInvalid();
      expect(api.callsTo('PATCH /sessions/:id')).toHaveLength(0);
    });

    it('limits the name to what the backend accepts', async () => {
      const { user } = renderMenu();
      await choose(user, 'Rename');
      expect(
        await screen.findByRole('textbox', { name: /Name/ }),
      ).toHaveAttribute('maxlength', '80');
    });

    it('counts the characters of a name as the backend does: an emoji is one', async () => {
      // 60 characters, 119 UTF-16 units: within the limit of 80 characters.
      const name = `${'😀'.repeat(59)}x`;
      const api = installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': session({ name: '😀'.repeat(59) }),
      });
      const { user } = renderMenu(runningSession({ name }));
      await user.click(
        screen.getByRole('button', { name: `Actions for ${name}` }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.type(field, '{Backspace}{Enter}');

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('PATCH /sessions/:id')[0]?.body).toEqual({
        name: '😀'.repeat(59),
      });
    });

    it('tells a name that is taken beside the field, not as a toast', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': failure(409, 'name_taken'),
      });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.type(field, ' 2');
      await user.click(screen.getByRole('button', { name: 'Rename session' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        errorText('name_taken'),
      );
      // The button was off while the server answered: the keyboard comes
      // back to the field.
      expect(field).toHaveFocus();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(shownToasts()).toEqual([]);
      await checkAccessibility(screen.getByRole('dialog'));

      await user.type(field, '3');
      await waitFor(() =>
        expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
      );
    });

    it('tells a name the backend finds invalid beside the field', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': failure(422, 'invalid_name'),
      });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.type(field, 'x{Enter}');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        errorText('invalid_name'),
      );
      expect(shownToasts()).toEqual([]);
    });

    it('tells any other failure once, as a toast, and keeps the dialog', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': failure(404, 'session_not_found'),
      });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });

      await user.type(field, '2{Enter}');

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: "Couldn't rename the session",
        description: 'This session no longer exists.',
      });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('can be left with Escape, and focus comes back to the menu button', async () => {
      const { user } = renderMenu();
      await choose(user, 'Rename');
      await screen.findByRole('dialog');

      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(trigger()).toHaveFocus();
    });

    it('keeps the dialog while the rename is under way', async () => {
      let finish: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'PATCH /sessions/:id': () =>
          new Promise((resolve) => {
            finish = () => resolve(session({ name: 'Bank' }));
          }),
      });
      const { user } = renderMenu();
      await choose(user, 'Rename');
      const field = await screen.findByRole('textbox', { name: /Name/ });
      await user.type(field, '2{Enter}');

      const submit = await screen.findByRole('button', {
        name: 'Rename session',
      });
      await waitFor(() => expect(submit).toBeDisabled());
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      finish?.();
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });
  });

  describe('Restart', () => {
    it('asks first, and says what happens', async () => {
      const api = installFakeApi({ 'GET /meta': meta() });
      const { user } = renderMenu();
      await choose(user, /^Restart/);

      const dialog = await screen.findByRole('dialog', {
        name: 'Restart "0001"?',
      });
      expect(dialog).toHaveTextContent(
        'The browser closes and opens again with the same tabs.',
      );
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(0);
    });

    it('restarts the session once confirmed', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/restart': runningSession({ activity: 'launching' }),
      });
      const { user } = renderMenu();
      await choose(user, /^Restart/);
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Restart session' }),
      );

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/restart')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
      expect(trigger()).toHaveFocus();
    });

    it('shows the work on the menu button while the restart is under way', async () => {
      let finish: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/restart': () =>
          new Promise((resolve) => {
            finish = () => resolve(runningSession());
          }),
      });
      const { user } = renderMenu();
      await choose(user, /^Restart/);
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Restart session' }),
      );

      await waitFor(() =>
        expect(trigger()).toHaveAttribute('aria-busy', 'true'),
      );
      expect(
        within(dialog).getByRole('button', { name: 'Restart session' }),
      ).toBeDisabled();
      finish?.();
      await waitFor(() => expect(trigger()).not.toHaveAttribute('aria-busy'));
    });

    it('tells a failure once and keeps the question open', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/restart': failure(502, 'proxy_unreachable'),
      });
      const { user } = renderMenu();
      await choose(user, /^Restart/);
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: 'Restart session' }),
      );

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]?.title).toBe("Couldn't restart the session");
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      const { user } = renderMenu();
      await choose(user, /^Restart/);
      await checkAccessibility(await screen.findByRole('dialog'));
    });
  });

  describe('Rotate IP', () => {
    it('asks first for a running session, whose browser restarts', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': runningSession({
          activity: 'assigning_proxy',
        }),
      });
      const { user } = renderMenu(runningSession());
      await choose(user, /^Rotate IP/);

      const dialog = await screen.findByRole('dialog', {
        name: 'Rotate the IP of "0001"?',
      });
      expect(dialog).toHaveTextContent(
        'The browser restarts with another working proxy. Cookies and logins are kept.',
      );
      expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(0);

      await user.click(
        within(dialog).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('rotates a stopped session at once: nothing is lost', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
      });
      const { user } = renderMenu(session());

      await choose(user, /^Rotate IP/);

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1),
      );
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('asks for proxies right there when none is free, rotates by itself once there are some, and tells no toast', async () => {
      let rotations = 0;
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': () =>
          ++rotations === 1
            ? failure(409, 'no_free_proxy')
            : session({ activity: 'assigning_proxy' }),
        'POST /proxies/import': {
          added: [proxy({ id: 5 })],
          duplicates: [],
          errors: [],
          summary: 'Added 1',
        },
        'GET /sessions/:id': session({ activity: 'assigning_proxy' }),
      });
      const { user } = renderMenu(session());

      await choose(user, /^Rotate IP/);

      const dialog = await screen.findByRole('dialog', {
        name: 'No free proxy available',
      });
      expect(dialog).toHaveTextContent(
        'Every session needs a proxy of its own, and none is free right now. Add proxies and the session will switch to one of them automatically.',
      );
      expect(shownToasts()).toEqual([]);
      await checkAccessibility(dialog);

      await user.click(
        within(dialog).getByRole('textbox', { name: 'Proxies, one per line' }),
      );
      await user.paste('198.51.100.9:8080');
      await user.click(
        within(dialog).getByRole('button', { name: 'Add proxies' }),
      );

      await waitFor(() =>
        expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(2),
      );
      expect(screen.queryByText("Couldn't rotate the IP")).toBeNull();
    });

    it('gives way from the question to the dialog that adds proxies when a running session finds none free', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': failure(409, 'no_free_proxy'),
      });
      const { user } = renderMenu(runningSession());
      await choose(user, /^Rotate IP/);
      const question = await screen.findByRole('dialog');

      await user.click(
        within(question).getByRole('button', { name: 'Rotate IP' }),
      );

      expect(
        await screen.findByRole('dialog', { name: 'No free proxy available' }),
      ).toBeInTheDocument();
      // The question is gone: one dialog at a time.
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('leaves the session as it is when the person gives up adding proxies', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': failure(409, 'no_free_proxy'),
      });
      const { user } = renderMenu(session());
      await choose(user, /^Rotate IP/);
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('POST /sessions/:id/rotate')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
    });

    it('does not start the session afterwards: only rotates it', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = installFakeApi({
          'GET /meta': meta(),
          'POST /sessions/:id/rotate': session({ activity: 'assigning_proxy' }),
          'GET /sessions/:id': sequence(
            session({ activity: 'assigning_proxy' }),
            session(),
          ),
        });
        const { user } = renderMenu(session());

        await choose(user, /^Rotate IP/);
        await waitFor(() =>
          expect(api.callsTo('GET /sessions/:id').length).toBeGreaterThan(0),
        );
        await act(() => vi.advanceTimersByTimeAsync(POLL_FAST_MS * 3));

        expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the question open, with the failure told once, when the rotation is refused for another reason', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': failure(409, 'session_busy'),
      });
      const { user } = renderMenu(runningSession());
      await choose(user, /^Rotate IP/);
      const question = await screen.findByRole('dialog');

      await user.click(
        within(question).getByRole('button', { name: 'Rotate IP' }),
      );

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]?.title).toBe("Couldn't rotate the IP");
      expect(screen.getByRole('dialog')).toBe(question);
    });

    it('tells any other failure once, as a toast', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/rotate': failure(409, 'session_busy'),
      });
      const { user } = renderMenu(session());

      await choose(user, /^Rotate IP/);

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: "Couldn't rotate the IP",
        description: errorText('session_busy'),
      });
    });
  });

  describe('Check IP', () => {
    it('says the place still matches', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/check-ip': runningSession(),
      });
      const { user } = renderMenu();

      await choose(user, /^Check IP/);

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: 'Exit IP unchanged',
        description:
          'The proxy still exits through 203.0.113.7. The time zone and location still match.',
      });
      expect(api.callsTo('POST /sessions/:id/check-ip')).toHaveLength(1);
    });

    it('warns when the proxy exits through another IP now', async () => {
      const running = runningSession();
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/check-ip': {
          ...running,
          proxy: running.proxy && { ...running.proxy, exitIp: '198.51.100.9' },
          location: running.location && { ...running.location, inSync: false },
        },
      });
      const { user } = renderMenu();

      await choose(user, /^Check IP/);

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]).toEqual({
        title: 'Exit IP changed',
        description:
          'The proxy now exits through 198.51.100.9, not 203.0.113.7. Restart the session to update its time zone and location.',
      });
    });

    it('tells a proxy that does not answer once, as a toast', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'POST /sessions/:id/check-ip': failure(502, 'proxy_unreachable'),
      });
      const { user } = renderMenu();

      await choose(user, /^Check IP/);

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]?.title).toBe("Couldn't check the IP");
    });
  });

  describe('Delete', () => {
    it('says what goes with the session: its profile and its own secrets', async () => {
      installFakeApi({ 'GET /meta': meta(), 'GET /secrets': list([]) });
      const { user } = renderMenu(session());
      await choose(user, 'Delete');

      const dialog = await screen.findByRole('dialog', {
        name: 'Delete "0001"?',
      });
      expect(dialog).toHaveTextContent(
        "The session's browser profile (cookies, site data, history) and its own secrets are deleted permanently. Its proxy becomes free.",
      );
      expect(dialog).not.toHaveTextContent('closed first');
      expect(
        within(dialog).getByRole('button', { name: 'Delete session' }),
      ).toBeInTheDocument();
    });

    it('says the browser of a running session is closed first', async () => {
      const { user } = renderMenu(runningSession());
      await choose(user, 'Delete');
      expect(await screen.findByRole('dialog')).toHaveTextContent(
        'The browser is closed first.',
      );
    });

    it('counts the secrets of the session, and only its own', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'GET /secrets': list([
          secretSummary({ id: 1 }),
          secretSummary({ id: 2 }),
        ]),
      });
      const { user } = renderMenu(session({ id: 7 }));
      await choose(user, 'Delete');

      expect(
        await screen.findByText('2 secrets are deleted with the session.'),
      ).toBeInTheDocument();
      expect(api.callsTo('GET /secrets')[0]?.query.get('scope')).toBe('7');
    });

    it('says "1 secret goes", in the singular', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /secrets': list([secretSummary()]),
      });
      const { user } = renderMenu(session());
      await choose(user, 'Delete');
      expect(
        await screen.findByText('1 secret is deleted with the session.'),
      ).toBeInTheDocument();
    });

    it('waits for the count before it can be confirmed', async () => {
      let answer: (() => void) | undefined;
      installFakeApi({
        'GET /meta': meta(),
        'GET /secrets': () =>
          new Promise((resolve) => {
            answer = () => resolve(list([]));
          }),
      });
      const { user } = renderMenu(session());
      await choose(user, 'Delete');
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });

      expect(confirm).toBeDisabled();
      answer?.();
      await waitFor(() => expect(confirm).toBeEnabled());
    });

    it('still deletes when the secrets could not be counted', async () => {
      installFakeApi({
        'GET /meta': meta(),
        'GET /secrets': failure(500, 'internal'),
        'DELETE /sessions/:id': undefined,
      });
      const { user } = renderMenu(session());
      await choose(user, 'Delete');
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      expect(screen.getByRole('dialog')).not.toHaveTextContent('go with it');
    });

    it('deletes the session once confirmed, then calls onDeleted', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        ...noSecrets(),
        'DELETE /sessions/:id': undefined,
      });
      const { user, onDeleted } = renderMenu(session({ id: 5 }));
      await choose(user, 'Delete');
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());

      await user.click(confirm);

      await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
      expect(api.callsTo('DELETE /sessions/:id')[0]?.params.id).toBe('5');
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('asks for nothing of the deleted session once it is going: not its page, not the count of its secrets', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        'GET /secrets': list([]),
        'GET /sessions/:id': session({ id: 5 }),
        'DELETE /sessions/:id': undefined,
      });
      // The page of the session, open beside its menu as it is on its own page.
      function PageOfTheSession() {
        useSession(5);
        return null;
      }
      const onDeleted = vi.fn();
      const { user } = renderApp(
        <ProxyFlowProvider>
          <SessionActionsMenu
            session={session({ id: 5 })}
            onDeleted={onDeleted}
          />
          <PageOfTheSession />
          <ToastList />
        </ProxyFlowProvider>,
      );
      await waitFor(() =>
        expect(api.callsTo('GET /sessions/:id')).toHaveLength(1),
      );
      await choose(user, 'Delete');
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());
      expect(api.callsTo('GET /secrets')).toHaveLength(1);

      await user.click(confirm);

      await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
      // Asking again could only have been answered with a 404.
      expect(api.callsTo('GET /sessions/:id')).toHaveLength(1);
      expect(api.callsTo('GET /secrets')).toHaveLength(1);
      expect(shownToasts()).toEqual([]);
    });

    it('does not delete when the person cancels', async () => {
      const api = installFakeApi({
        'GET /meta': meta(),
        ...noSecrets(),
        'DELETE /sessions/:id': undefined,
      });
      const { user, onDeleted } = renderMenu(session());
      await choose(user, 'Delete');
      const dialog = await screen.findByRole('dialog');

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(api.callsTo('DELETE /sessions/:id')).toHaveLength(0);
      expect(onDeleted).not.toHaveBeenCalled();
      expect(trigger()).toHaveFocus();
    });

    it('tells a failure once and keeps the question, without calling onDeleted', async () => {
      installFakeApi({
        'GET /meta': meta(),
        ...noSecrets(),
        'DELETE /sessions/:id': failure(404, 'session_not_found'),
      });
      const { user, onDeleted } = renderMenu(session());
      await choose(user, 'Delete');
      const confirm = await screen.findByRole('button', {
        name: 'Delete session',
      });
      await waitFor(() => expect(confirm).toBeEnabled());

      await user.click(confirm);

      await waitFor(() => expect(shownToasts()).toHaveLength(1));
      expect(shownToasts()[0]?.title).toBe("Couldn't delete the session");
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(onDeleted).not.toHaveBeenCalled();
    });

    it('has no accessibility violations', async () => {
      const { user } = renderMenu(runningSession());
      await choose(user, 'Delete');
      await checkAccessibility(await screen.findByRole('dialog'));
    });
  });
});
