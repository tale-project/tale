import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { installFakeApi, list } from '@/tests/utils/fake-api';
import { meta, session } from '@/tests/utils/fixtures';
import { renderApp } from '@/tests/utils/render';

vi.mock('@tanstack/react-router', async () =>
  (await import('@/tests/utils/sessions-router')).createSessionsRouterMock(),
);

import { setOpenPath } from '@/tests/utils/sessions-router';
import { showPhone } from '@/tests/utils/viewport';

import { ProxyFlowProvider } from './proxy-flow-provider';
import { SessionsLayout } from './sessions-layout';

beforeEach(() => {
  setOpenPath('/sessions/1');
  installFakeApi({
    'GET /meta': meta(),
    'GET /sessions': list([session()]),
  });
});

afterEach(() => {
  showPhone(false);
});

describe('SessionsLayout', () => {
  it('shows the list of sessions beside the page that is open', async () => {
    renderApp(
      <ProxyFlowProvider>
        <SessionsLayout />
      </ProxyFlowProvider>,
    );

    expect(screen.getByRole('navigation', { name: 'Sessions' })).toBeVisible();
    expect(await screen.findByRole('link', { name: /0001/ })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Open page' })).toBeVisible();
  });

  it('shows the page alone on a phone, which reaches the list as a screen of its own', () => {
    showPhone(true);
    renderApp(
      <ProxyFlowProvider>
        <SessionsLayout />
      </ProxyFlowProvider>,
    );

    expect(screen.queryByRole('navigation', { name: 'Sessions' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Open page' })).toBeVisible();
  });

  it('has no accessibility violations', async () => {
    const view = renderApp(
      <ProxyFlowProvider>
        <SessionsLayout />
      </ProxyFlowProvider>,
    );
    await screen.findByRole('link', { name: /0001/ });
    await checkAccessibility(view);
  });
});
