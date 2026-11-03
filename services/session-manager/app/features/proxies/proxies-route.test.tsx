import { screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { installFakeApi } from '@/tests/utils/fake-api';
import { meta } from '@/tests/utils/fixtures';
import { proxyPool } from '@/tests/utils/proxies-api';
import { renderInShell } from '@/tests/utils/render';

import { ProxiesPage } from './components/proxies-page';

/** What the route file hands to `createFileRoute`. */
interface CapturedRoute {
  head?: () => unknown;
  component?: ComponentType;
}
const captured = vi.hoisted(() => ({ options: {} as CapturedRoute }));

vi.mock('@tanstack/react-router', async () => {
  const { createLinkingRouterStub } = await import('@/tests/utils/router-stub');
  return {
    ...createLinkingRouterStub('/proxies'),
    createFileRoute: () => (options: CapturedRoute) => {
      captured.options = options;
      return { options };
    },
  };
});

await import('../../routes/proxies');

describe('the proxies route', () => {
  it('titles the document after the section and the app', () => {
    expect(captured.options.head?.()).toEqual({
      meta: [{ title: 'Proxies - Session Manager' }],
    });
  });

  it('shows the proxies page', async () => {
    installFakeApi({
      'GET /proxies': proxyPool(() => []),
      'GET /meta': () => meta(),
    });
    const Page = captured.options.component;
    expect(Page).toBe(ProxiesPage);
    if (Page === undefined) throw new Error('the route has no page');

    renderInShell(<Page />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Proxies' }),
    ).toBeVisible();
    expect(await screen.findByText('No proxies yet')).toBeVisible();
  });
});
