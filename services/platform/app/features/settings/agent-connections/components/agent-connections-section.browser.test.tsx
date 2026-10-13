import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { i18n } from '@/lib/i18n/i18n';
import { render, screen, waitFor } from '@/tests/utils/render';

import '@/app/globals.css';

import type { AgentConnection } from '../types';
import { AgentConnectionsSection } from './agent-connections-section';

// Real-Chromium coverage for what jsdom cannot lay out: the list of connected
// agents fits every screen in every language — a very long app name, an
// unverified app, the widest access an agent can hold and the longest German
// and French words included — without scrolling sideways, keeps the menu that
// disconnects an agent in reach on a phone, keeps the choice of whose agents
// to see in reach, and passes an audit in both themes.

const h = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/mutations', () => ({
  useDisconnectAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useAgentConnections: h.list,
}));
vi.mock(
  '@/app/features/settings/model-endpoints/hooks/use-api-settings-access',
  () => ({
    useApiSettingsAccess: () => ({ developer: true, connectAgents: true }),
  }),
);
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { status: 'ok', userId: 'ada', isAdmin: true },
  }),
}));

const DAY = 24 * 60 * 60 * 1000;
const LONG_NAME =
  'Claude Code mit einem außergewöhnlich langen Namen Verwaltungsvorschriftenänderungsbefugnisse';

function row(overrides: Partial<AgentConnection>): AgentConnection {
  return {
    id: 'conn-1',
    userId: 'ada',
    clientName: 'Claude Code',
    provenance: 'metadata_document',
    clientHost: 'claude.ai',
    scopes: ['tale:mcp', 'tale:automations.write'],
    createdAt: Date.now() - 20 * DAY,
    lastUsedAt: Date.now() - 3 * 60 * 60 * 1000,
    revokedAt: null,
    revokeReason: null,
    personName: 'Ada Lovelace',
    personEmail: 'ada@example.test',
    ...overrides,
  };
}

const ROWS: AgentConnection[] = [
  row({}),
  row({
    id: 'conn-2',
    userId: 'mia',
    clientName: LONG_NAME,
    provenance: 'registered',
    clientHost: null,
    scopes: [
      'tale:mcp',
      'tale:automations.write',
      'tale:automations.deploy',
      'tale:settings.read',
      'tale:settings.write',
      'tale:subscriptions.connect',
    ],
    lastUsedAt: null,
    personName: 'Mia Keller-Schmidtbauer-Hohenzollernstrasse',
    personEmail: 'mia.keller.schmidtbauer.hohenzollernstrasse@example.test',
  }),
  row({
    id: 'conn-3',
    userId: 'noah',
    clientName: 'Cursor',
    clientHost: 'cursor.com',
    scopes: ['tale:mcp'],
    revokedAt: Date.now() - 2 * DAY,
    revokeReason: 'refresh_reuse',
    personName: null,
    personEmail: 'noah@example.test',
  }),
];

beforeEach(() => {
  h.list.mockReturnValue({
    data: { connections: ROWS, canSeeEveryone: true },
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  localStorage.removeItem('user-locale');
});

/** The settings rail a wide screen puts beside the page, in pixels. */
const RAIL = 332;

/** The page as the settings layout frames it: a padded pane — beside the
 * rail from `lg` — the standard measure, and the content scrolling in the
 * document. */
function renderPage(viewport = window.innerWidth) {
  return render(
    <div
      className="p-4"
      style={{ width: viewport >= 1024 ? viewport - RAIL : viewport }}
    >
      <SettingsPage>
        <AgentConnectionsSection organizationId="org-1" />
      </SettingsPage>
    </div>,
  );
}

async function openEveryoneWithEnded(
  user: ReturnType<typeof renderPage>['user'],
) {
  await user.click(
    screen.getByRole('radio', { name: /^(Everyone|Alle|Tous)$/ }),
  );
  await user.click(
    screen.getByRole('checkbox', {
      name: /^(Show disconnected|Getrennte anzeigen|Afficher les déconnectés)$/,
    }),
  );
  await waitFor(() =>
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3),
  );
}

describe('the connected agents fit the screen [AGCONN-R24]', () => {
  for (const language of ['en', 'de', 'fr']) {
    for (const width of [320, 390, 640, 768, 1024, 1280]) {
      it(`has no sideways scroll at ${width}px in ${language}, with every agent of everyone, a very long name and the widest access`, async () => {
        await page.viewport(width, 900);
        localStorage.setItem('user-locale', language);
        await i18n.changeLanguage(language);
        const { user } = renderPage(width);
        await openEveryoneWithEnded(user);

        // The page itself never scrolls sideways: a table wider than the pane
        // scrolls in its own frame, as every table in Settings does.
        const root = document.scrollingElement as HTMLElement;
        expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
        const frame = screen
          .getByRole('table')
          .closest('.overflow-x-auto') as HTMLElement;
        // The table fits its frame at every width: the columns a screen has
        // no room for are left out, so nothing waits off to the right.
        expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth + 1);
        // The menu that disconnects an agent is in reach.
        const menu = screen.getAllByRole('button', {
          name: /Claude Code/,
        })[0] as HTMLElement;
        expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(
          root.clientWidth,
        );
        // Everything around the table that holds words stays inside the pane.
        for (const element of document.querySelectorAll<HTMLElement>(
          'h2, p, label, a, button, [role="radio"], [role="checkbox"]',
        )) {
          if (frame.contains(element)) continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0) continue;
          expect(
            box.right,
            `${element.tagName} ${element.textContent?.slice(0, 40)}`,
          ).toBeLessThanOrEqual(root.clientWidth + 0.5);
        }
      });
    }
  }

  it('keeps the choice of whose agents to see, and the way to connect one, in reach on a phone', async () => {
    await page.viewport(320, 700);
    renderPage();
    for (const control of [
      screen.getByRole('radio', { name: 'Mine' }),
      screen.getByRole('radio', { name: 'Everyone' }),
      screen.getByRole('checkbox', { name: 'Show disconnected' }),
      screen.getByRole('button', { name: 'Connect a coding agent' }),
    ]) {
      expect(control).toBeVisible();
      const box = control.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
    }
    // A touch target a thumb can hit (WCAG 2.5.8). The checkbox is a 16px box
    // with a 24px hit area around it, which its own box does not measure.
    for (const target of [
      screen.getByRole('radio', { name: 'Mine' }),
      screen.getByRole('radio', { name: 'Everyone' }),
      screen.getByRole('button', { name: 'Connect a coding agent' }),
    ]) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    }
  });

  it('shows what an agent may do and when it last called from a tablet, and when it connected beside the rail', async () => {
    await page.viewport(800, 900);
    const tablet = renderPage(800);
    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Access' }),
      ).toBeVisible(),
    );
    expect(
      screen.getByRole('columnheader', { name: 'Last used' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('columnheader', { name: 'Connected' }),
    ).not.toBeInTheDocument();
    tablet.unmount();

    await page.viewport(1280, 900);
    renderPage(1280);
    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Connected' }),
      ).toBeVisible(),
    );
  });

  it('keeps what a phone needs to disconnect an agent: its name and its menu', async () => {
    await page.viewport(320, 700);
    renderPage();
    expect(screen.getByText('Claude Code')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Actions for Claude Code' }),
    ).toBeInTheDocument();
    // What a phone has no room for is out of the table, not squeezed in.
    expect(
      screen.queryByRole('columnheader', { name: 'Access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: 'Last used' }),
    ).not.toBeInTheDocument();
  });

  it('tells the agents apart on a phone: what each may do and when it last called, under its name', async () => {
    await page.viewport(320, 700);
    renderPage();
    // The first agent holds one level and called three hours ago; the second
    // holds everything, an app that registered itself, and never called.
    expect(screen.getByText('Edit automations')).toBeVisible();
    expect(screen.getAllByText('Last used 3 hours ago')[0]).toBeVisible();
    expect(screen.getByText('Connect AI subscriptions')).toBeVisible();
    expect(screen.getByText('Never used')).toBeVisible();
  });
});

describe('the connected agents in both themes [AGCONN-R24]', () => {
  it.each(['light', 'dark'])(
    'passes an accessibility audit with everyone’s agents, the disconnected ones and an app nobody verified (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(1100, 900);
      const { container, user } = renderPage();
      await openEveryoneWithEnded(user);
      const result = await axe.run(container, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(result.violations).toEqual([]);
    },
  );
});
