import '@testing-library/jest-dom/vitest';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
} from '@/tests/utils/lapsed-session';
import { inkContrast } from '@/tests/utils/paint';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { AutomationsList } from './automations-list';

import '@/app/globals.css';

/**
 * The automations list's Trigger column in real Chromium, for what
 * jsdom cannot judge: every state names itself in words at AA contrast in
 * both themes, whole in every shipped language at a laptop width, and a
 * keyboard that reaches a row reads its trigger beside its deployed version
 * — no hover, no colour alone.
 */

const { automations } = vi.hoisted(() => {
  const row = (
    name: string,
    displayName: string,
    deployedVersion: number | undefined,
    trigger:
      | {
          kind: 'schedule' | 'webhook' | 'event';
          enabled: boolean;
          lastSkipReason: 'paused_after_failures' | null;
        }
      | null
      | 'absent',
  ) => ({
    name,
    latest: 2,
    projectIds: [],
    ...(deployedVersion !== undefined && { deployedVersion }),
    presentation: { name: displayName },
    ...(trigger !== 'absent' && { trigger }),
  });
  return {
    automations: [
      row('ops/digest', 'Morning digest', 2, {
        kind: 'schedule',
        enabled: true,
        lastSkipReason: null,
      }),
      row('ops/nightly', 'Nightly export', 1, {
        kind: 'schedule',
        enabled: false,
        lastSkipReason: 'paused_after_failures',
      }),
      row('ops/intake', 'Intake hook', 2, {
        kind: 'webhook',
        enabled: false,
        lastSkipReason: null,
      }),
      row('ops/draft', 'Event draft', undefined, {
        kind: 'event',
        enabled: true,
        lastSkipReason: null,
      }),
      row('ops/by-hand', 'Run by hand', 1, null),
      row('ops/older', 'Older server row', 1, 'absent'),
    ],
  };
});

vi.mock('../hooks/queries', async (importOriginal) => ({
  // Only the listing is synthetic; the module's other reads stay real for
  // the dialogs the list imports.
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useAutomations: () => ({
    data: automations,
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/app/features/projects/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/projects/hooks/queries')
  >()),
  useNamedProjects: () => ({ projects: new Map(), isPending: false }),
}));

vi.mock('@/app/hooks/use-ability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-ability')>()),
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-preload-route', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-preload-route')>()),
  usePreloadRoute: () => () => undefined,
}));

vi.mock('./automation-row-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./automation-row-actions')>()),
  AutomationRowActions: () => null,
}));

/** Each row's Trigger cell as English reads it: the state, then the kind. */
const TRIGGER_WORDS = {
  'Morning digest': ['Enabled', 'Schedule'],
  'Nightly export': ['Paused', 'Schedule'],
  'Intake hook': ['Off', 'Webhook'],
  'Event draft': ['Not live', 'Platform event'],
  'Run by hand': ['Manual', 'By hand, API or MCP'],
  'Older server row': ['Unknown'],
} as const;

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  await forgetSavedLocale();
});

function renderList() {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/dashboard/$id/automations',
      component: () => <AutomationsList organizationId="org-test" />,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/dashboard/$id/automations/$automationSlug/editor',
      component: () => null,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-test/automations'],
    }),
  });
  return render(<RouterProvider router={router} />);
}

/** The Trigger column's header in each shipped language. */
const TRIGGER_HEADER = { en: 'Trigger', de: 'Trigger', fr: 'Déclencheur' };

/** The Trigger column's cell in the row its name links from. */
function triggerCell(displayName: string, heading = 'Trigger'): HTMLElement {
  const header = screen
    .getAllByRole('columnheader')
    .findIndex((cell) => cell.textContent?.trim() === heading);
  const row = screen.getByRole('link', { name: displayName }).closest('tr');
  const cell = row?.querySelectorAll<HTMLElement>('td')[header];
  if (cell === undefined) throw new Error(`no Trigger cell for ${displayName}`);
  return cell;
}

/** Every element that draws a piece of text inside `root`. */
function inked(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter((element) =>
    [...element.childNodes].some(
      (node) =>
        node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '',
    ),
  );
}

describe('the Trigger column in real Chromium', () => {
  it.each(['light', 'dark'])(
    'names every state in words at AA contrast in %s mode',
    async (theme) => {
      await page.viewport(1280, 800);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      renderList();
      await screen.findByRole('link', { name: 'Morning digest' });
      const table = screen.getByRole('table');
      // Judge the settled colours, not a theme transition in flight.
      await new Promise((resolve) => setTimeout(resolve, 400));

      for (const [displayName, expected] of Object.entries(TRIGGER_WORDS)) {
        const pieces = inked(triggerCell(displayName));
        expect(pieces.map((piece) => piece.textContent?.trim())).toEqual(
          expected,
        );
        for (const piece of pieces) {
          expect(inkContrast(piece)).toBeGreaterThanOrEqual(4.5);
        }
      }

      const audit = await axe.run(table, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      });
      expect(audit.violations).toEqual([]);
      expect(audit.passes.some((rule) => rule.id === 'color-contrast')).toBe(
        true,
      );
    },
  );

  it.each(SHIPPED_LOCALES)(
    'keeps every state and kind whole at 1280 px in %s',
    async (locale) => {
      await page.viewport(1280, 800);
      saveLocale(locale);
      renderList();
      await screen.findByRole('link', { name: 'Morning digest' });
      for (const displayName of Object.keys(TRIGGER_WORDS)) {
        const cell = triggerCell(displayName, TRIGGER_HEADER[locale]);
        for (const piece of inked(cell)) {
          // Whole on one line, never cut to an ellipsis that only a hover
          // could open.
          expect(piece.scrollWidth).toBeLessThanOrEqual(piece.clientWidth);
          expect(piece.getClientRects()).toHaveLength(1);
        }
      }
    },
  );

  it('reads the trigger of a row beside its version once the keyboard reaches it', async () => {
    await page.viewport(1280, 800);
    renderList();
    const link = await screen.findByRole('link', { name: 'Nightly export' });
    for (let tab = 0; tab < 12 && document.activeElement !== link; tab++) {
      await userEvent.keyboard('{Tab}');
    }
    expect(link).toHaveFocus();
    // A keyboard focus draws the link's ring.
    expect(getComputedStyle(link).boxShadow).not.toBe('none');
    const row = link.closest('tr');
    if (row === null) throw new Error('no row for Nightly export');
    expect(within(row).getByText('Live: v1')).toBeVisible();
    expect(within(row).getByText('Paused')).toBeVisible();
    expect(within(row).getByText('Schedule')).toBeVisible();
    // The column says what the words belong to.
    expect(screen.getByRole('columnheader', { name: 'Trigger' })).toBeVisible();
  });
});
