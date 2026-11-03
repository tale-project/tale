import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { meta, runningSession, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/4');
});

import { StartStopButton } from './start-controls';

function Page({ shown }: { shown: Session }) {
  return (
    <ProxyFlowProvider>
      <StartStopButton session={shown} />
    </ProxyFlowProvider>
  );
}

function setup(
  shown: Session,
  routes: Parameters<typeof installFakeApi>[0] = {},
) {
  const api = installFakeApi({ 'GET /meta': meta(), ...routes });
  const view = renderApp(<Page shown={shown} />);
  return { ...view, api };
}

describe('StartStopButton', () => {
  it('starts a stopped session, and stops one that runs', async () => {
    const { user, api, rerender } = setup(session({ id: 4 }), {
      'POST /sessions/:id/start': session({ id: 4, status: 'starting' }),
      'POST /sessions/:id/stop': session({ id: 4, status: 'stopping' }),
    });
    await user.click(screen.getByRole('button', { name: 'Start session' }));
    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/start')).toHaveLength(1),
    );

    rerender(<Page shown={runningSession({ id: 4 })} />);
    await user.click(screen.getByRole('button', { name: 'Stop session' }));
    await waitFor(() =>
      expect(api.callsTo('POST /sessions/:id/stop')).toHaveLength(1),
    );
  });

  // The keyboard stays on the button through the whole turn from Start to
  // Stop: a second button in its place would leave the focus on the page.
  it('keeps the keyboard when Start turns into Stop, and Stop into Start', async () => {
    let answerStart: (value: Session) => void = () => {};
    let answerStop: (value: Session) => void = () => {};
    const { user, rerender } = setup(session({ id: 4 }), {
      'POST /sessions/:id/start': () =>
        new Promise<Session>((resolve) => {
          answerStart = resolve;
        }),
      'POST /sessions/:id/stop': () =>
        new Promise<Session>((resolve) => {
          answerStop = resolve;
        }),
    });
    const button = screen.getByRole('button', { name: 'Start session' });
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toHaveFocus();

    answerStart(session({ id: 4, status: 'starting', activity: 'launching' }));
    rerender(
      <Page
        shown={session({ id: 4, status: 'starting', activity: 'launching' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stop session' })).toBe(button);
    expect(button).toHaveFocus();

    rerender(<Page shown={runningSession({ id: 4 })} />);
    expect(screen.getByRole('button', { name: 'Stop session' })).toBe(button);
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'));
    expect(button).toHaveFocus();
    answerStop(session({ id: 4, status: 'stopping' }));

    rerender(<Page shown={session({ id: 4, status: 'stopping' })} />);
    expect(screen.getByRole('button', { name: 'Stop session' })).toBe(button);
    expect(button).toHaveFocus();

    rerender(<Page shown={session({ id: 4 })} />);
    expect(screen.getByRole('button', { name: 'Start session' })).toBe(button);
    expect(button).toHaveFocus();
  });

  it('keeps the keyboard when a start is asked a question and the answer is no', async () => {
    const { user } = setup(session({ id: 4 }), {
      'POST /sessions/:id/start': failure(409, 'ip_in_use', 'x', {
        exitIp: '203.0.113.7',
        sessions: [{ id: 2, name: 'Shop', status: 'running' }],
      }),
    });
    const button = screen.getByRole('button', { name: 'Start session' });
    button.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Start session' })).toBe(button);
    expect(button).toHaveFocus();
  });

  it('holds Stop, ready to press, while the session starts', () => {
    setup(session({ status: 'starting', activity: 'launching' }));
    const button = screen.getByRole('button', { name: 'Stop session' });
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it.each([
    ['while it stops', session({ status: 'stopping' })],
    ['while a proxy is assigned', session({ activity: 'assigning_proxy' })],
  ])('is busy and off, but still reachable by keyboard, %s', (_when, shown) => {
    setup(shown);
    const button = screen.getByRole('button', { name: /session$/ });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Not natively disabled: a disabled button leaves the tab order.
    expect(button).not.toBeDisabled();
  });

  it('cannot start while the browser is not there, and says why when it is focused', async () => {
    const { user } = setup(session(), {
      'GET /meta': meta({ browserInstalled: false, browserInstalling: false }),
    });
    const button = screen.getByRole('button', { name: 'Start session' });
    await waitFor(() =>
      expect(button).toHaveAttribute('aria-disabled', 'true'),
    );
    await user.tab();
    expect(button).toHaveFocus();
    expect(
      await screen.findAllByText("The browser isn't installed yet."),
    ).not.toHaveLength(0);
  });

  it('has no accessibility violations', async () => {
    const view = setup(runningSession());
    await checkAccessibility(view);
  });
});
