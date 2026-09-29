import '@testing-library/jest-dom/vitest';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import { DirtyBlockerProvider } from '@tale/ui/editor';
import { viewportAtRest } from '@tale/ui/testing/flow';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
  useNavigate,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { MobileBottomNav } from '@/app/components/layout/mobile-bottom-nav';
import { i18n } from '@/lib/i18n/i18n';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import { automationEditorSearchSchema } from '../lib/editor-search';
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

const { automation } = vi.hoisted(() => {
  const nodes: {
    id: string;
    type: string;
    code: string;
    input?: Record<string, string>;
  }[] = [
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
  ];
  // Every node placed, so the canvas never waits on the layout engine.
  const positions: Record<string, { x: number; y: number }> = {
    pulls: { x: 0, y: 0 },
    diff: { x: 0, y: 196 },
    summary: { x: 0, y: 392 },
  };
  return {
    automation: {
      name: 'pr-digest',
      nodes,
      ui: { positions },
      deployedVersion: 1 as number | undefined,
    },
  };
});

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
    data: {
      document: automation,
      version: version ?? 2,
      deployedVersion: automation.deployedVersion,
    },
    isPending: false,
  }),
  useAutomations: () => ({
    data: [{ name: 'pr-digest', projectIds: [], presentation: undefined }],
  }),
  useAutomationVersions: () => ({
    data: [
      {
        version: 2,
        message: 'Updated the summary',
        testsPassed: true,
        createdBy: 'user:a',
        createdAt: 1_700_000_100_000,
      },
      {
        version: 1,
        testsPassed: false,
        message: 'first cut',
        createdBy: 'user:a',
        createdAt: 1_700_000_000_000,
      },
    ],
  }),
  useAutomationRuns: () => ({ data: [] }),
  useAutomationProjects: () => ({ data: [] }),
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useSaveAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartAutomationRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeployAutomation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  useNavigationItems: () => ({
    primary: [
      {
        label: 'Home',
        href: '/dashboard/org-test/home',
        to: '/dashboard/$id/home',
        params: { id: 'org-test' },
      },
    ],
    pinned: [],
  }),
}));
vi.mock(
  '@/app/components/branding/branding-provider',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/branding/branding-provider')
    >()),
    useBrandingContext: () => ({ accentColor: null }),
  }),
);

afterEach(cleanup);

const ZOOM_CONTROLS = ['Zoom in', 'Zoom out', 'Reset view'];

/** The dashboard layout's frame (`routes/dashboard/$id.tsx`): a column as
 * tall as the window whose `main` hands the page its height, with the phone
 * header that hosts the breadcrumb below `md`. */
function DashboardFrame() {
  return (
    <DirtyBlockerProvider>
      <AdaptiveHeaderProvider>
        <div className="mobile-nav-shell flex h-dvh w-full flex-col overflow-hidden">
          <header className="border-border border-b px-4 md:hidden">
            <AdaptiveHeaderSlot />
          </header>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Outlet />
          </main>
          <MobileBottomNav organizationId="org-test" />
        </div>
      </AdaptiveHeaderProvider>
    </DirtyBlockerProvider>
  );
}

function EditorPage() {
  const { version, history } = useSearch({ strict: false });
  const navigate = useNavigate();
  return (
    <AutomationDetailShell organizationId="org-test" automationSlug="pr-digest">
      <AutomationEditor
        organizationId="org-test"
        automationSlug="pr-digest"
        version={version}
        showVersionHistory={history}
        onSelectVersion={(next) =>
          void navigate({
            to: '/dashboard/$id/automations/$automationSlug/editor',
            params: { id: 'org-test', automationSlug: 'pr-digest' },
            search: next === undefined ? {} : { version: next },
          })
        }
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
    validateSearch: automationEditorSearchSchema,
  });
  const generalRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard/$id/automations/$automationSlug/general',
    component: () => (
      <AutomationDetailShell
        organizationId="org-test"
        automationSlug="pr-digest"
      >
        <p>General settings</p>
      </AutomationDetailShell>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editorRoute, generalRoute]),
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
  it.each([
    ['en', 'Close'],
    ['de', 'Schließen'],
    ['fr', 'Fermer'],
  ])(
    'keeps one localized node close action on tablets in %s',
    async (locale, closeLabel) => {
      await page.viewport(900, 800);
      const previousLanguage = i18n.language;
      const previousLocale = localStorage.getItem('user-locale');
      localStorage.setItem('user-locale', locale);
      await i18n.changeLanguage(locale);
      try {
        renderEditorTab();
        await userEvent.click(
          await screen.findByRole('button', { name: /^pulls/i }),
        );
        const sheet = await screen.findByRole('dialog', { name: 'pulls' });
        const closeActions = within(sheet).getAllByRole('button', {
          name: /^(Close|Schließen|Fermer)$/,
        });
        expect(closeActions).toHaveLength(1);
        expect(closeActions[0]).toHaveAccessibleName(closeLabel);
        await userEvent.click(closeActions[0]!);
        await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      } finally {
        cleanup();
        if (previousLocale === null) localStorage.removeItem('user-locale');
        else localStorage.setItem('user-locale', previousLocale);
        await i18n.changeLanguage(previousLanguage);
      }
    },
  );

  it.each([320, 390, 1280])(
    'keeps detailed version history in the tab strip at %ipx',
    async (width) => {
      await page.viewport(width, 844);
      renderEditorTab();
      const picker = await screen.findByRole('button', { name: 'Version' });
      const strip = screen.getByRole('navigation', {
        name: 'Automations navigation',
      });
      expect(strip.contains(picker)).toBe(true);
      expect(screen.queryByRole('link', { name: 'Versions' })).toBeNull();
      const bounds = picker.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThan(
        screen.getByRole('link', { name: 'Editor' }).getBoundingClientRect()
          .right,
      );
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(bounds.width).toBeLessThan(100);
      expect(bounds.top).toBeGreaterThanOrEqual(
        strip.getBoundingClientRect().top,
      );
      expect(bounds.bottom).toBeLessThanOrEqual(
        strip.getBoundingClientRect().bottom,
      );
      expect(
        screen
          .getByRole('group', { name: 'Automation canvas' })
          .contains(picker),
      ).toBe(false);
      await userEvent.click(picker);
      const history = await screen.findByRole('dialog', { name: 'Versions' });
      expect(history.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(history.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await vi.waitFor(() =>
        expect(screen.getByText('Updated the summary')).toBeVisible(),
      );
      const versionRow = screen
        .getByRole('radio', { name: /^v2/ })
        .closest('label')!;
      const [identity, metadata] = Array.from(
        versionRow.lastElementChild!.children,
      ).map((element) => element.getBoundingClientRect());
      expect(metadata.left).toBeCloseTo(identity.left, 0);
      expect(metadata.top).toBeGreaterThanOrEqual(identity.bottom);
      expect(versionRow.getBoundingClientRect().height).toBeLessThanOrEqual(60);
      const editorTab = screen
        .getByRole('link', { name: 'Editor' })
        .getBoundingClientRect();
      expect(bounds.top + bounds.height / 2).toBeCloseTo(
        editorTab.top + editorTab.height / 2,
        0,
      );
      expect(screen.getByRole('img', { name: 'Tests passed' })).toBeVisible();
      expect(screen.getByRole('img', { name: 'Tests failed' })).toBeVisible();
      expect(screen.getByRole('radio', { name: /^v2/ })).toBeChecked();
      if (width === 320) {
        await vi.waitFor(() =>
          expect(screen.getByRole('radio', { name: /^v2/ })).toHaveFocus(),
        );
        // Match the shared RadioGroup browser test: the runner's keyboard
        // helper does not drive Radix roving focus reliably.
        screen.getByRole('radio', { name: /^v2/ }).dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        );
      } else {
        await userEvent.click(screen.getByText('first cut'));
      }
      await vi.waitFor(() => expect(picker).toHaveTextContent('v1'));
      await vi.waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Versions' })).toBeNull(),
      );
      await userEvent.click(screen.getByRole('link', { name: 'General' }));
      await screen.findByText('General settings');
      await userEvent.click(screen.getByRole('button', { name: 'Version' }));
      await userEvent.click(await screen.findByRole('radio', { name: /^v1/ }));
      await screen.findByRole('group', { name: 'Automation canvas' });
      expect(screen.getByRole('button', { name: 'Version' })).toHaveTextContent(
        'v1',
      );
    },
  );

  it("fills the phone with the canvas — running behind the pill like a table's rows — and keeps editor actions clear of it", async () => {
    await page.viewport(390, 844);
    renderEditorTab();
    const canvas = await expectWholeCanvas();
    const action = screen.getByRole('button', { name: 'Test run' });
    expect(canvas.contains(action)).toBe(true);
    expect(canvas.getBoundingClientRect().height).toBeGreaterThan(500);
    expect(
      document.querySelector('[data-floating-actions-pad-count]'),
    ).toBeNull();
    const actionBox = action.getBoundingClientRect();
    const canvasBox = canvas.getBoundingClientRect();
    expect(actionBox.left).toBeGreaterThanOrEqual(canvasBox.left);
    expect(actionBox.right).toBeLessThanOrEqual(canvasBox.right);
    expect(actionBox.bottom).toBeLessThan(canvasBox.bottom);
    const reset = screen.getByRole('button', { name: 'Reset view' });
    const zoom = screen
      .getByRole('button', { name: 'Zoom in' })
      .getBoundingClientRect();
    const toolbar = action.closest('.react-flow__panel');
    const cornerPanel = reset.closest('.react-flow__panel');
    expect(toolbar?.getBoundingClientRect().left).toBeGreaterThan(zoom.right);
    expect(
      screen.getByRole('navigation', { name: 'Primary navigation' }),
    ).toHaveAttribute('data-compact');
    const nav = screen
      .getByRole('navigation', { name: 'Primary navigation' })
      .getBoundingClientRect();
    // The canvas's own dot-grid background runs the full height, behind the
    // pill, the same way a collection screen's rows pass beneath it.
    expect(canvasBox.bottom).toBeCloseTo(844, 0);
    // The two interactive overlays inside it — the action toolbar and the
    // zoom cluster — stay clear of the pill instead, so nothing the reader
    // can tap ends up hidden or hit-tested behind it.
    expect(toolbar?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      nav.top,
    );
    expect(cornerPanel?.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      nav.top,
    );
    expect(toolbar?.getBoundingClientRect().height).toBeLessThan(150);
    expect(
      document
        .elementFromPoint(actionBox.left + 10, actionBox.top + 10)
        ?.closest('button'),
    ).toBe(action);
    const resetBox = reset.getBoundingClientRect();
    expect(
      document
        .elementFromPoint(resetBox.left + 10, resetBox.top + 10)
        ?.closest('button'),
    ).toBe(reset);
  });

  it('hides Run live on the phone toolbar when nothing is deployed, but keeps it disabled with a reason on desktop', async () => {
    automation.deployedVersion = undefined;
    try {
      await page.viewport(390, 844);
      renderEditorTab();
      await expectWholeCanvas();
      await screen.findByRole('button', { name: 'Test run' });
      expect(screen.queryByRole('button', { name: 'Run live' })).toBeNull();

      cleanup();
      await page.viewport(1280, 800);
      renderEditorTab();
      const runLive = await screen.findByRole('button', { name: 'Run live' });
      expect(runLive).toHaveAttribute('aria-disabled', 'true');
    } finally {
      automation.deployedVersion = 1;
    }
  });

  it("opens a picked node's fields in a sheet on a phone, Save and Discard beside them, and never stacks or scrolls the canvas", async () => {
    await page.viewport(390, 844);
    renderEditorTab();
    const canvas = await expectWholeCanvas();
    const pageScroll = scrollContainerOf(canvas);
    const canvasBoxBefore = canvas.getBoundingClientRect();

    // The canvas's own floating toolbar never carries Save/Discard — checked
    // before the sheet opens, since a modal hides the rest of the page from
    // the accessibility tree once it does.
    const toolbar = screen
      .getByRole('button', { name: 'Test run' })
      .closest('.react-flow__panel');
    if (!(toolbar instanceof HTMLElement)) throw new Error('no toolbar');
    expect(within(toolbar).queryByRole('button', { name: 'Save' })).toBeNull();

    await selectNode('pulls');

    // The canvas never learns a node was picked: no stacking, no page
    // scroll, still edge to edge exactly as before the selection — the
    // side-panel column (`AUTO-F37`) has no compact counterpart to reserve.
    const canvasBox = canvas.getBoundingClientRect();
    expect(canvasBox.width).toBeCloseTo(canvasBoxBefore.width, 0);
    expect(canvasBox.height).toBeCloseTo(canvasBoxBefore.height, 0);
    expect(pageScroll.scrollHeight).toBe(pageScroll.clientHeight);
    expect(screen.queryByRole('region', { name: 'pulls' })).toBeNull();

    // The fields — and the document's Save/Discard — live in a sheet over
    // the canvas instead, not the side panel and not the canvas's own
    // floating toolbar.
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('textbox', { name: 'Code' })).toBeVisible();
    const save = within(sheet).getByRole('button', { name: 'Save' });
    const discard = within(sheet).getByRole('button', { name: 'Discard' });
    expect(save).toBeDisabled();
    expect(discard).toBeDisabled();

    // Escape closes the sheet without touching the canvas underneath.
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(canvas.getBoundingClientRect().height).toBeCloseTo(
      canvasBoxBefore.height,
      0,
    );
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

  it('runs the workbench edge to edge under the tab strip', async () => {
    await page.viewport(1280, 800);
    renderEditorTab();
    const canvas = await expectWholeCanvas();
    const strip = screen.getByRole('navigation', {
      name: 'Automations navigation',
    });
    // The page's own box — `clientWidth`/`clientHeight` leave out a classic
    // scrollbar's reserved gutter, which is the page layout's, not an inset.
    const pageScroll = scrollContainerOf(canvas);
    const frame = pageScroll.getBoundingClientRect();

    // No inset around the workbench: the canvas starts at the page's left
    // edge right under the strip, and with no node picked there is no
    // inspector — the canvas runs to the page's right edge.
    let canvasBox = canvas.getBoundingClientRect();
    expect(canvasBox.left).toBeCloseTo(frame.left, 0);
    expect(canvasBox.top).toBeCloseTo(strip.getBoundingClientRect().bottom, 0);
    expect(canvasBox.right).toBeCloseTo(frame.left + pageScroll.clientWidth, 0);
    expect(screen.queryByRole('region', { name: 'pulls' })).toBeNull();

    // A picked node opens the inspector: it ends at the page's right and
    // bottom edges, and meets the canvas at its border with no gutter.
    await selectNode('pulls');
    const inspector = screen.getByRole('region', { name: 'pulls' });
    canvasBox = canvas.getBoundingClientRect();
    const inspectorBox = inspector.getBoundingClientRect();
    expect(inspectorBox.right).toBeCloseTo(
      frame.left + pageScroll.clientWidth,
      0,
    );
    expect(inspectorBox.bottom).toBeCloseTo(
      frame.top + pageScroll.clientHeight,
      0,
    );
    expect(canvasBox.right).toBeCloseTo(inspectorBox.left, 0);
    // Unframed: the canvas draws no border of its own; the inspector's one
    // border faces it.
    expect(getComputedStyle(canvas).borderLeftWidth).toBe('0px');
    expect(getComputedStyle(inspector).borderLeftWidth).toBe('1px');
    expect(getComputedStyle(inspector).borderTopWidth).toBe('0px');
  });

  it('pans a picked box back into view when the inspector narrows the canvas', async () => {
    await page.viewport(1280, 800);
    const { nodes } = automation;
    const { positions } = automation.ui;
    // A box fitted against the canvas's right edge: the inspector's column
    // opens right over where it was drawn.
    automation.nodes = [
      ...nodes,
      { id: 'archive', type: 'transform', code: 'return {};' },
    ];
    automation.ui.positions = { ...positions, archive: { x: 1600, y: 0 } };
    try {
      renderEditorTab();
      const canvas = await expectWholeCanvas();
      const box = await screen.findByRole('button', { name: /^archive/i });
      await userEvent.click(box);
      await screen.findByRole('textbox', { name: 'Code' });
      await expect
        .poll(() => {
          const frame = canvas.getBoundingClientRect();
          const rect = box.getBoundingClientRect();
          return rect.left >= frame.left - 1 && rect.right <= frame.right + 1;
        })
        .toBe(true);
      // The pan leaves the box 24px inside the edge, so the box is in the
      // frame before the 200ms pan ends: measure where the view comes to rest.
      await viewportAtRest(canvas);

      // Closing hands the width back without moving the graph: focus returns
      // to the box, which is already in sight.
      const settled = box.getBoundingClientRect();
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.activeElement).toBe(box);
      // A pan that must not come has no event to await: the pause gives one
      // time to show. A runner too slow to draw it in time can only miss it,
      // never fail a graph that holds still.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const after = box.getBoundingClientRect();
      expect(after.left).toBeCloseTo(settled.left, 0);
      expect(after.top).toBeCloseTo(settled.top, 0);
    } finally {
      automation.nodes = nodes;
      automation.ui.positions = positions;
    }
  });
});
