import '@testing-library/jest-dom/vitest';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { DirtyBlockerProvider } from '@tale/ui/editor';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { AutomationDetailShell } from './automation-detail-shell';
import { AutomationEditor } from './automation-editor';

import '@/app/globals.css';

/**
 * The Editor tab's workbench, laid out by a real browser. jsdom performs no
 * layout, so only here can the canvas be seen losing its bottom edge: the
 * canvas slot clips with `overflow-hidden`, and the zoom cluster sits in the
 * canvas's bottom-left corner — a row squeezed below the canvas's own floor
 * cuts those controls off first.
 */

const { automation } = vi.hoisted(() => ({
  automation: {
    name: 'pr-digest',
    nodes: [
      { id: 'pulls', type: 'transform', code: 'return { items: [] };' },
      {
        id: 'diff',
        type: 'transform',
        input: { pulls: '{{ nodes.pulls.output.items }}' },
        code: 'return { text: "" };',
      },
      {
        id: 'summary',
        type: 'transform',
        input: { diff: '{{ nodes.diff.output.text }}' },
        code: 'return { text: "" };',
      },
    ],
    // Every node placed, so the canvas never waits on the layout engine.
    ui: {
      positions: {
        pulls: { x: 0, y: 0 },
        diff: { x: 0, y: 196 },
        summary: { x: 0, y: 392 },
      },
    },
  },
}));

// Browser ESM links named imports eagerly, so every mocked module keeps its
// real exports and overrides only the hooks this page reads.
vi.mock('@/app/hooks/use-ability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-ability')>()),
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));

vi.mock('@/app/features/projects/hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/projects/hooks/queries')
  >()),
  useProjects: () => ({ projects: [], isLoading: false }),
}));

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useAutomation: (
    _organizationId: string,
    _name: string,
    version?: number,
  ) => ({
    data: { document: automation, version: version ?? 1 },
    isPending: false,
  }),
  useAutomations: () => ({
    data: [{ name: 'pr-digest', projectIds: [], presentation: undefined }],
  }),
  useAutomationVersions: () => ({
    data: [
      {
        version: 1,
        message: 'first cut',
        createdBy: 'user:a',
        createdAt: 1_700_000_000_000,
      },
    ],
  }),
  useAutomationRuns: () => ({ data: [] }),
  useAutomationTriggers: () => ({ data: [] }),
  useAutomationProjects: () => ({ data: [] }),
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useSaveAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartAutomationRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeployAutomation: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAutomationTrigger: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAutomationTrigger: () => ({ mutate: vi.fn(), isPending: false }),
  useSetAutomationProjects: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

const ZOOM_CONTROLS = ['Zoom in', 'Zoom out', 'Reset view'];

/** The dashboard layout's frame (`routes/dashboard/$id.tsx`): a column as
 * tall as the window whose `main` hands the page its height, with the phone
 * header that hosts the breadcrumb below `md`. */
function DashboardFrame() {
  return (
    <DirtyBlockerProvider>
      <AdaptiveHeaderProvider>
        <div className="flex h-dvh w-full flex-col overflow-hidden">
          <header className="border-border border-b px-4 md:hidden">
            <AdaptiveHeaderSlot />
          </header>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
        </div>
      </AdaptiveHeaderProvider>
    </DirtyBlockerProvider>
  );
}

function EditorPage() {
  return (
    <AutomationDetailShell organizationId="org-test" automationSlug="pr-digest">
      <AutomationEditor
        organizationId="org-test"
        automationSlug="pr-digest"
        onSelectVersion={vi.fn()}
      />
    </AutomationDetailShell>
  );
}

function renderEditorTab() {
  const rootRoute = createRootRoute({ component: DashboardFrame });
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/$id/automations/$automationSlug/editor',
    component: EditorPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editorRoute]),
    history: createMemoryHistory({
      initialEntries: ['/dashboard/org-test/automations/pr-digest/editor'],
    }),
  });
  return render(<RouterProvider router={router} />);
}

function isScrollContainer(element: Element) {
  const { overflowX, overflowY } = getComputedStyle(element);
  return [overflowX, overflowY].some(
    (value) => value === 'auto' || value === 'scroll',
  );
}

/**
 * The share of `element` its clipping ancestors leave drawn. The walk stops
 * at the nearest scroll container: whatever lies past that edge is a scroll
 * away, not cut off.
 */
function unclippedShare(element: Element) {
  const box = element.getBoundingClientRect();
  let { top, right, bottom, left } = box;
  for (
    let ancestor = element.parentElement;
    ancestor !== null && !isScrollContainer(ancestor);
    ancestor = ancestor.parentElement
  ) {
    const { overflowX, overflowY } = getComputedStyle(ancestor);
    if (overflowX === 'visible' && overflowY === 'visible') continue;
    const clip = ancestor.getBoundingClientRect();
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
    left = Math.max(left, clip.left);
  }
  const drawn = Math.max(0, right - left) * Math.max(0, bottom - top);
  return drawn / (box.width * box.height);
}

function scrollContainerOf(element: Element) {
  for (
    let ancestor = element.parentElement;
    ancestor !== null;
    ancestor = ancestor.parentElement
  ) {
    if (isScrollContainer(ancestor)) return ancestor;
  }
  throw new Error('The canvas has no scrolling ancestor');
}

/** Open a node in the inspector, the way the report's screen had one open.
 * A real pointer click: React Flow's pane reads the event's window on
 * mousedown, which a synthesized event does not carry. */
async function selectNode(id: string) {
  await userEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^${id}`, 'i') }),
  );
  await screen.findByRole('textbox', { name: 'Code' });
}

async function expectWholeCanvas() {
  for (const name of ZOOM_CONTROLS) {
    const control = await screen.findByRole('button', { name });
    expect(unclippedShare(control), name).toBeCloseTo(1, 2);
  }
  const canvas = screen.getByRole('group', { name: 'Automation canvas' });
  expect(unclippedShare(canvas)).toBeCloseTo(1, 2);
  return canvas;
}

describe('automation editor workbench in Chromium', () => {
  it('stacks the whole canvas above the inspector on a phone and scrolls the page', async () => {
    // An iPhone SE's window: shorter than the canvas and a node's inspector
    // stacked together, which is exactly when the page has to scroll.
    await page.viewport(375, 667);
    renderEditorTab();
    await selectNode('pulls');

    const canvas = await expectWholeCanvas();
    const pageScroll = scrollContainerOf(canvas);
    expect(pageScroll.scrollHeight).toBeGreaterThan(pageScroll.clientHeight);
  });

  it('fills the tab with the workbench on a desktop without scrolling the page', async () => {
    await page.viewport(1280, 800);
    renderEditorTab();
    await selectNode('pulls');

    const canvas = await expectWholeCanvas();
    // Taller than its 24rem floor: the row took the height the strip left.
    expect(canvas.getBoundingClientRect().height).toBeGreaterThan(24 * 16);
    const pageScroll = scrollContainerOf(canvas);
    expect(pageScroll.scrollHeight).toBe(pageScroll.clientHeight);
  });
});
