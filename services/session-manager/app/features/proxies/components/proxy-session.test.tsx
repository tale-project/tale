import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { proxy, proxyCheck, sessionRef } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return createLinkingRouterStub('/proxies');
});

import { resetLanguage, showLanguage } from '@/tests/utils/language';

import { ProxySession } from './proxy-session';

afterEach(resetLanguage);

describe('ProxySession', () => {
  it('says a proxy nobody has is free', () => {
    renderApp(<ProxySession proxy={proxy()} />);
    expect(screen.getByText('Free')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links to the session that has the proxy, with its state in words', () => {
    renderApp(
      <ProxySession
        proxy={proxy({
          session: sessionRef({ id: 4, name: 'work', status: 'running' }),
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'work' })).toHaveAttribute(
      'href',
      '/sessions/4',
    );
    expect(screen.getByText('Running')).toBeVisible();
  });

  it.each([
    ['stopped', 'Stopped'],
    ['starting', 'Starting'],
    ['stopping', 'Stopping'],
    ['error', 'Error'],
  ] as const)('says a %s session is %s', (status, words) => {
    renderApp(
      <ProxySession proxy={proxy({ session: sessionRef({ status }) })} />,
    );
    expect(screen.getByText(words)).toBeVisible();
  });

  it('puts the session first, also when its proxy stopped working', () => {
    renderApp(
      <ProxySession
        proxy={proxy({
          session: sessionRef({ name: 'work' }),
          check: proxyCheck({ status: 'failed', ok: false }),
        })}
      />,
    );
    expect(screen.getByRole('link', { name: 'work' })).toBeVisible();
    expect(screen.queryByText('Not assigned')).not.toBeInTheDocument();
  });

  it('warns that a proxy with the exit IP of another session is not assigned, and says why in the page', () => {
    renderApp(
      <ProxySession
        proxy={proxy({ sameIpAs: sessionRef({ id: 3, name: '0003' }) })}
      />,
    );
    expect(screen.getByText('Same IP as 0003')).toBeVisible();
    // The rule is text, not a tooltip: a keyboard and a touch screen read it.
    const why =
      'Not assigned while the session "0003" has a proxy with the same exit IP.';
    expect(screen.getByText(why)).toBeVisible();
    expect(screen.queryByTitle(why)).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('names the session that has the same exit IP in full, however long its name', () => {
    const name = 'Competitor research for the autumn campaign';
    renderApp(
      <ProxySession proxy={proxy({ sameIpAs: sessionRef({ id: 3, name }) })} />,
    );
    // The badge may be cut to the cell; the sentence under it is not.
    expect(
      screen.getByText(
        `Not assigned while the session "${name}" has a proxy with the same exit IP.`,
      ),
    ).toBeVisible();
  });

  it('says a proxy that does not work is not assigned, and that none ever is', () => {
    renderApp(
      <ProxySession
        proxy={proxy({
          check: proxyCheck({ status: 'failed', ok: false }),
        })}
      />,
    );
    expect(screen.getByText('Not assigned')).toBeVisible();
    const why = "A proxy that isn't working is never assigned to a session.";
    expect(screen.getByText(why)).toBeVisible();
    expect(screen.queryByTitle(why)).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('speaks German', async () => {
    await showLanguage('de');
    renderApp(
      <ProxySession
        proxy={proxy({ sameIpAs: sessionRef({ name: '0003' }) })}
      />,
    );
    expect(screen.getByText('Dieselbe IP wie 0003')).toBeVisible();
    expect(
      screen.getByText(
        'Nicht zugewiesen, solange die Sitzung „0003“ einen Proxy mit derselben Ausgangs-IP hat.',
      ),
    ).toBeVisible();
  });

  it.each([
    ['free', proxy()],
    ['in use', proxy({ session: sessionRef({ status: 'running' }) })],
    ['same IP', proxy({ sameIpAs: sessionRef({ name: '0003' }) })],
    ['failed', proxy({ check: proxyCheck({ status: 'failed', ok: false }) })],
  ])('has no accessibility violations (%s)', async (_state, row) => {
    const view = renderApp(<ProxySession proxy={row} />);
    await checkAccessibility(view);
  });
});
