import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { i18n } from '@/lib/i18n/i18n';
import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

// Real-Chromium coverage for what jsdom cannot lay out: the page of a coding
// agent fits a phone in every language — a very long app name and the
// longest German and French words included — keeps its two actions in reach,
// and passes an audit in both themes.

const h = vi.hoisted(() => ({
  context: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    getSession: h.getSession,
    $fetch: vi.fn(),
    oauth2: { consent: vi.fn() },
  },
}));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: h.context,
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ signOut: vi.fn() }),
}));
vi.mock('@/app/components/logo/logo-link', () => ({
  LogoLink: () => <a href="/">Tale</a>,
}));

import { AgentConsent } from './agent-consent';

const HOUR = 60 * 60 * 1000;
const ASKED =
  'tale:mcp tale:automations.write tale:automations.deploy tale:settings.read tale:settings.write tale:subscriptions.connect offline_access';
const CEILING = ASKED.split(' ').filter((scope) => scope !== 'offline_access');

const LONG_NAME =
  'Claude Code mit einem außergewöhnlich langen Namen Verwaltungsvorschriftenänderungsbefugnisse';

function organization(
  id: string,
  name: string,
  role: string,
  allowed: boolean,
) {
  return {
    id,
    slug: id,
    name,
    role,
    allowed,
    ...(allowed ? {} : { reason: 'AGENT_CONNECT_FORBIDDEN' as const }),
    ceiling: allowed ? CEILING : [],
    previous: null,
  };
}

function context(provenance: 'metadata_document' | 'registered') {
  return {
    client: {
      id: 'https://claude.ai/oauth/c.json',
      name: LONG_NAME,
      provenance,
      host: provenance === 'metadata_document' ? 'claude.ai' : null,
    },
    requestedScopes: ASKED.split(' '),
    eligible: true,
    activeOrganizationId: 'org-1',
    organizations: [
      organization('org-1', 'Acme', 'developer', true),
      organization('org-2', 'Beta Labs', 'member', false),
    ],
  };
}

function renderPage() {
  window.history.pushState(
    {},
    '',
    `/oauth/consent?client_id=c&scope=${encodeURIComponent(ASKED)}&redirect_uri=${encodeURIComponent('http://127.0.0.1:54545/callback')}&exp=${Math.floor(Date.now() / 1000) + 600}&code_challenge=x&sig=y`,
  );
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AgentConsent email="ada.lovelace.with.a.very.long.address@example.test" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.context.mockResolvedValue(context('metadata_document'));
  // A sign-in from before yesterday: the password block shows too.
  h.getSession.mockResolvedValue({
    data: {
      user: { email: 'ada@example.test' },
      session: { createdAt: new Date(Date.now() - 25 * HOUR) },
    },
  });
});

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
});

/** The page's own scrolling frame: the one `AuthPageLayout` makes. */
function frame(): HTMLElement {
  const main = document.querySelector('main');
  const parent = main?.parentElement;
  if (!parent) throw new Error('the page has no frame');
  return parent;
}

describe('the page of a coding agent fits the screen', () => {
  for (const language of ['en', 'de', 'fr']) {
    for (const width of [320, 390, 1280]) {
      it(`has no sideways scroll at ${width}px in ${language}, with a very long app name and an unverified app`, async () => {
        await page.viewport(width, 800);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        h.context.mockResolvedValue(context('registered'));
        renderPage();
        await vi.waitFor(() =>
          expect(document.querySelector('[role="radio"]')).not.toBeNull(),
        );
        const root = frame();
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
        // Everything that holds words stays inside the column.
        for (const element of root.querySelectorAll<HTMLElement>(
          'h1, p, label, button, [role="radio"], [role="checkbox"], li',
        )) {
          const box = element.getBoundingClientRect();
          expect(
            box.right,
            `${element.tagName} ${element.textContent?.slice(0, 40)}`,
          ).toBeLessThanOrEqual(root.clientWidth + 0.5);
        }
      });
    }
  }

  it('keeps Connect and Cancel one under the other, full width, at the end of the page', async () => {
    await page.viewport(390, 800);
    renderPage();
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect' })).toBeVisible(),
    );
    const connect = screen.getByRole('button', { name: 'Connect' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const connectBox = connect.getBoundingClientRect();
    const cancelBox = cancel.getBoundingClientRect();
    expect(cancelBox.top).toBeGreaterThan(connectBox.bottom - 1);
    expect(connectBox.width).toBeCloseTo(cancelBox.width, 0);
    expect(connectBox.width).toBeGreaterThan(300);
  });
});

describe('the page of a coding agent in both themes', () => {
  it.each(['light', 'dark'])(
    'passes an accessibility audit with the password block and an app nobody verified (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(800, 900);
      h.context.mockResolvedValue(context('registered'));
      const { container } = renderPage();
      await vi.waitFor(() =>
        expect(
          screen.getByRole('group', { name: 'Confirm it’s you' }),
        ).toBeVisible(),
      );
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
    },
  );
});
