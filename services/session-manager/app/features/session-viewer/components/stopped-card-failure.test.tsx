import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProxyFlowProvider } from '@/app/features/sessions/components/proxy-flow-provider';
import type { Session } from '@/lib/api/schemas';
import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi } from '@/tests/utils/fake-api';
import { meta, session } from '@/tests/utils/fixtures';
import { resetLanguage, showLanguage } from '@/tests/utils/language';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () => {
  const { createRouterStub } = await import('@/tests/utils/router-stub');
  return createRouterStub('/sessions/1');
});

import { StoppedCard } from './stopped-card';

afterEach(async () => {
  cleanup();
  await resetLanguage();
});

function setup(overrides: Partial<Session>) {
  installFakeApi({ 'GET /meta': meta() });
  return renderApp(
    <ProxyFlowProvider>
      <StoppedCard session={session(overrides)} />
    </ProxyFlowProvider>,
  );
}

const CAUSE = 'the proxy rejected the credentials (HTTP 407)';

// The card is where a session that could not start says why, and what to do.
describe('StoppedCard: the reason a session could not start', () => {
  it('says why its proxy does not work, in the words of the proxy check', () => {
    setup({
      status: 'error',
      errorCode: 'proxy_unreachable',
      errorExtra: { proxyId: 4, reason: CAUSE },
      error: `Its proxy is not working: ${CAUSE}. Use “Rotate IP” to give the session another proxy.`,
    });
    expect(
      screen.getByText(
        `This session's proxy isn't working: ${CAUSE}. Choose Rotate IP to give the session another proxy.`,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rotate IP' })).toBeEnabled();
  });

  it('says how many proxies failed their check when none could be given', () => {
    setup({
      status: 'error',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 2 },
      error: 'No working proxy available (2 failed their check).',
    });
    expect(
      screen.getByText(
        'No working proxy is available (2 proxies failed their check). Add proxies or check the existing ones, then try again.',
      ),
    ).toBeVisible();
  });

  it('says it also for a rotation that found none: the session stays stopped', () => {
    setup({
      status: 'stopped',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 1 },
      error: 'No working proxy available (1 failed their check).',
    });
    expect(
      screen.getByText(/\(1 proxy failed its check\)\. Add proxies/),
    ).toBeVisible();
  });

  it('says why the time zone and location cannot be matched', () => {
    setup({
      status: 'error',
      errorCode: 'unknown_ip_location',
      errorExtra: {
        reason: 'the GeoIP database has no location for 203.0.113.7',
      },
    });
    expect(
      screen.getByText(
        "Couldn't find the time zone and location of the proxy's exit IP: the GeoIP database has no location for 203.0.113.7.",
      ),
    ).toBeVisible();
  });

  it.each([
    [
      'proxy_unreachable',
      "This session's proxy isn't working. Choose Rotate IP to give the session another proxy.",
    ],
    [
      'no_working_proxy',
      'No working proxy is available. Add proxies or check the existing ones, then try again.',
    ],
    [
      'unknown_ip_location',
      "Couldn't find the time zone and location of the proxy's exit IP.",
    ],
  ])(
    'says no more than the code when %s carries no details (older data)',
    (errorCode, sentence) => {
      setup({ status: 'error', errorCode, errorExtra: null, error: 'x' });
      expect(screen.getByText(sentence)).toBeVisible();
    },
  );

  it('keeps a long cause inside the card and readable', async () => {
    const view = setup({
      status: 'error',
      errorCode: 'proxy_unreachable',
      errorExtra: {
        reason: `no IP echo service answered through the proxy: ${'https://api.ipify.org?format=json: unexpected answer (HTTP 500); '.repeat(8)}`,
      },
    });
    const sentence = screen.getByText(
      /^This session's proxy isn't working: no IP echo service/,
    );
    expect(sentence).toBeVisible();
    expect(sentence.textContent).toMatch(/…\. Choose Rotate IP/);
    await checkAccessibility(view);
  });

  it('speaks German, with the cause as the proxy check worded it', async () => {
    await showLanguage('de');
    setup({
      status: 'error',
      errorCode: 'proxy_unreachable',
      errorExtra: { reason: CAUSE },
    });
    expect(
      await screen.findByText(
        `Der Proxy dieser Sitzung funktioniert nicht: ${CAUSE}. Wähle IP wechseln, damit die Sitzung einen anderen Proxy bekommt.`,
      ),
    ).toBeVisible();
  });

  it('speaks French, with the plural of the language', async () => {
    await showLanguage('fr');
    setup({
      status: 'error',
      errorCode: 'no_working_proxy',
      errorExtra: { failed: 3 },
    });
    expect(
      await screen.findByText(/\(3 proxys ont échoué à la vérification\)/),
    ).toBeVisible();
  });
});
