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
import axe from 'axe-core';
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

const { automation, check } = vi.hoisted(() => {
  const nodes: {
    id: string;
    type: string;
    code: string;
    input?: Record<string, string>;
    when?: string;
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
  // The canvas lays every document out itself (ELK, in a worker); nothing
  // is placed by hand.
  return {
    automation: {
      name: 'pr-digest',
      nodes,
      deployedVersion: 1 as number | undefined,
    },
    /** What the draft check answers: nothing, unless a test plants a problem. */
    check: {
      errors: [] as Array<Record<string, unknown> & { id: string }>,
      warnings: [] as Array<Record<string, unknown> & { id: string }>,
    },
  };
});

/** The `diff` node's code starts with a word the check refuses. */
const CODE_PROBLEM = {
  id: 'error|REF_UNKNOWN_NODE|/nodes/1/code|0-6',
  level: 'error',
  code: 'REF_UNKNOWN_NODE',
  message: 'nodes.nope does not exist',
  at: { pointer: '/nodes/1/code', range: [0, 6] },
  params: { node: 'diff', field: 'code', ref: 'nope', available: ['pulls'] },
};

/** The `summary` node's input reads a number where text is wanted. */
const INPUT_WARNING = {
  id: 'warning|TYPE_MISMATCH|/nodes/2/input/diff|3-26',
  level: 'warning',
  code: 'TYPE_MISMATCH',
  nodeId: 'summary',
  message: 'node "summary" input.diff: expects string, but it is number',
  at: { pointer: '/nodes/2/input/diff', range: [3, 26] },
  params: {
    node: 'summary',
    consumer: 'connector-input',
    property: 'diff',
    expr: '{{ nodes.diff.output.text }}',
    expected: 'string',
    actual: 'number',
  },
};

// The check is a server round trip; the page's handling of its answer is
// what these tests lay out, so the hook answers from `check`.
vi.mock('../hooks/use-automation-validation', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../hooks/use-automation-validation')
  >()),
  useAutomationValidation: ({ document }: { document: unknown }) => {
    const hash = document === null ? null : JSON.stringify(document);
    return {
      status: 'ready',
      errors: check.errors,
      warnings: check.warnings,
      settledFor: hash,
      currentHash: hash,
    };
  },
  useInvalidateAutomationValidation: () => () => undefined,
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
  useProjectHarnesses: () => ({ data: { harnesses: [], models: [] } }),
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
  useAutomationTriggers: () => ({ data: [] }),
  useNodeTypeCatalog: () => ({ data: undefined, isError: false }),
}));

vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useSaveAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStartAutomationRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeployAutomation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-navigation-items', () => ({
  isItemActive: (item: { href: string }, pathname: string) =>
    pathname === item.href || pathname.startsWith(`${item.href}/`),
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

afterEach(() => {
  cleanup();
  check.errors = [];
  check.warnings = [];
  document.documentElement.classList.remove('dark');
});

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
  await expectLaidOut();
  await userEvent.click(
    await screen.findByRole('button', { name: new RegExp(`^${id}`, 'i') }),
  );
  await screen.findByRole('textbox', { name: 'Code' });
}

/** The chart is drawn: the canvas laid the document out (in a worker, the
 * first time a while), the frame is no longer busy and the view has come to
 * rest. */
async function expectLaidOut() {
  const canvas = await screen.findByRole(
    'group',
    { name: 'Automation canvas' },
    { timeout: 20_000 },
  );
  await vi.waitFor(() => expect(canvas).toHaveAttribute('aria-busy', 'false'), {
    timeout: 20_000,
  });
  await viewportAtRest(canvas);
  return canvas;
}

/** The canvas as it is shown: the chart, or the List view that stands in
 * for it on a narrow screen. */
function canvasView() {
  return (
    screen.queryByRole('group', { name: 'Automation canvas' }) ??
    screen.getByRole('list', { name: 'Automation canvas' })
  );
}

async function expectWholeCanvas() {
  await expectLaidOut();
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
      // Narrower than 24rem the List view stands in for the chart.
      expect(canvasView().contains(picker)).toBe(false);
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
      await vi.waitFor(() => canvasView());
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
    // Six nodes that read nothing make the chart as wide as the canvas
    // once it is fitted: the right-most box sits against the canvas's
    // right edge, where the inspector's column opens.
    automation.nodes = [
      ...nodes,
      ...['archive', 'backup', 'cleanup', 'digest', 'export'].map((id) => ({
        id,
        type: 'transform',
        code: 'return {};',
      })),
    ];
    try {
      renderEditorTab();
      const canvas = await expectWholeCanvas();
      const roots = [
        'pulls',
        'archive',
        'backup',
        'cleanup',
        'digest',
        'export',
      ];
      const boxes = await Promise.all(
        roots.map((id) =>
          screen.findByRole('button', { name: new RegExp(`^${id}`, 'i') }),
        ),
      );
      const box = boxes.reduce((right, candidate) =>
        candidate.getBoundingClientRect().right >
        right.getBoundingClientRect().right
          ? candidate
          : right,
      );
      // The inspector's column is 22rem wide.
      const inspectorWidth = 22 * 16;
      expect(box.getBoundingClientRect().right).toBeGreaterThan(
        canvas.getBoundingClientRect().right - inspectorWidth,
      );
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

      // Closing hands the width back: focus returns to the box, and the
      // view — still the canvas's own fit, nobody moved it — follows the
      // canvas back to its full width with the box in sight.
      await userEvent.keyboard('{Escape}');
      await expect.poll(() => document.activeElement).toBe(box);
      await viewportAtRest(canvas);
      const frame = canvas.getBoundingClientRect();
      const after = box.getBoundingClientRect();
      expect(after.left).toBeGreaterThanOrEqual(frame.left - 1);
      expect(after.right).toBeLessThanOrEqual(frame.right + 1);
    } finally {
      automation.nodes = nodes;
    }
  });

  it('opens Problems under the canvas column on a desktop and goes to the offending text', async () => {
    check.errors = [CODE_PROBLEM];
    await page.viewport(1280, 800);
    renderEditorTab();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Problems: 1 error' }),
    );
    const dock = await screen.findByRole('region', { name: 'Problems' });
    // The dock takes part of the canvas column, never the whole canvas: the
    // zoom cluster above it stays drawn.
    await expectWholeCanvas();
    const canvas = screen.getByRole('group', { name: 'Automation canvas' });
    expect(dock.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      canvas.getBoundingClientRect().bottom - 1,
    );
    const row = within(dock).getByRole('button', { name: /Error:/ });
    await vi.waitFor(() => expect(row).toHaveFocus());
    await userEvent.keyboard('{Enter}');

    const code = await screen.findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code',
    });
    await vi.waitFor(() => expect(code).toHaveFocus());
    expect([code.selectionStart, code.selectionEnd]).toEqual([0, 6]);
    // The inspector opened beside the canvas, and the dock stays open.
    expect(screen.getByRole('region', { name: 'Problems' })).toBeVisible();
    const box = screen.getByRole('button', { name: /^diff/i });
    expect(box).toHaveAccessibleName(/\(1 error\)$/);
  });

  it('lists Problems in a sheet on a tablet and hands the reader to the node sheet', async () => {
    check.errors = [CODE_PROBLEM];
    await page.viewport(900, 800);
    renderEditorTab();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Problems: 1 error' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Problems' });
    const row = within(sheet).getByRole('button', { name: /Error:/ });
    await vi.waitFor(() => expect(row).toHaveFocus());
    await userEvent.keyboard('{Enter}');

    const nodeSheet = await screen.findByRole('dialog', { name: 'diff' });
    const code = within(nodeSheet).getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Code',
    });
    await vi.waitFor(() => expect(code).toHaveFocus());
    expect([code.selectionStart, code.selectionEnd]).toEqual([0, 6]);
    expect(screen.queryByRole('dialog', { name: 'Problems' })).toBeNull();
  });

  it.each(['light', 'dark'])(
    'keeps the Problems dock, the node marks and the field messages readable in %s',
    async (theme) => {
      check.errors = [CODE_PROBLEM];
      check.warnings = [INPUT_WARNING];
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await page.viewport(1280, 800);
      renderEditorTab();
      await userEvent.click(
        await screen.findByRole('button', {
          name: 'Problems: 1 error and 1 warning',
        }),
      );
      const dock = await screen.findByRole('region', { name: 'Problems' });
      await selectNode('summary');
      const input = screen.getByRole('textbox', { name: 'Input' });
      // A warning describes the field without marking it invalid.
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(input).toHaveAccessibleDescription(/Warning:/);
      // The boxes carry both marks: the one-digit chips are too short for
      // axe to judge, so @tale/ui's severity test measures their colours.
      expect(
        screen.getByRole('button', { name: /^diff/i }),
      ).toHaveAccessibleName(/\(1 error\)$/);
      expect(
        screen.getByRole('button', { name: /^summary/i }),
      ).toHaveAccessibleName(/\(1 warning\)$/);
      // Let the dock finish fading in: axe reads colours at rest.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const inspector = screen.getByRole('region', { name: 'summary' });
      for (const region of [dock, inspector]) {
        const result = await axe.run(region, {
          runOnly: [
            'color-contrast',
            'aria-allowed-attr',
            'aria-valid-attr-value',
            'button-name',
            'list',
            'listitem',
          ],
        });
        expect(result.violations).toEqual([]);
        expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
          true,
        );
      }
    },
  );

  it('reopens the Problems sheet on every problem, so focus never stays behind it', async () => {
    check.errors = [CODE_PROBLEM];
    await page.viewport(900, 800);
    renderEditorTab();
    const button = await screen.findByRole('button', {
      name: 'Problems: 1 error',
    });
    await userEvent.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Problems' });
    await userEvent.click(
      within(sheet).getByRole('radio', { name: 'Warnings' }),
    );
    await vi.waitFor(() =>
      expect(within(sheet).getByText('No warnings')).toBeVisible(),
    );
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Problems' })).toBeNull(),
    );

    await userEvent.click(button);
    const reopened = await screen.findByRole('dialog', { name: 'Problems' });
    expect(
      within(reopened).getByRole('radio', { name: 'All' }),
    ).toHaveAttribute('aria-checked', 'true');
    const row = within(reopened).getByRole('button', { name: /Error:/ });
    await vi.waitFor(() => expect(row).toHaveFocus());
  });

  it('takes the reader from the phone node sheet to the problems that hold Save', async () => {
    check.errors = [CODE_PROBLEM];
    await page.viewport(390, 844);
    renderEditorTab();
    // The error is in "diff"; the reader edits "summary".
    await selectNode('summary');
    const nodeSheet = await screen.findByRole('dialog');
    await userEvent.type(
      within(nodeSheet).getByRole('textbox', { name: 'Code' }),
      ' ',
    );
    expect(within(nodeSheet).getByText('Fix 1 error to save')).toBeVisible();
    await userEvent.click(
      within(nodeSheet).getByRole('button', { name: 'Show problems' }),
    );

    const sheet = await screen.findByRole('dialog', { name: 'Problems' });
    const row = within(sheet).getByRole('button', { name: /Error:/ });
    await vi.waitFor(() => expect(row).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'summary' })).toBeNull();
  });

  it('says why Save waits in a visible line on a phone', async () => {
    check.errors = [CODE_PROBLEM];
    await page.viewport(390, 844);
    renderEditorTab();
    await selectNode('diff');
    const sheet = await screen.findByRole('dialog');
    await userEvent.type(
      within(sheet).getByRole('textbox', { name: 'Code' }),
      ' ',
    );
    const reason = within(sheet).getByText('Fix 1 error to save');
    expect(reason).toBeVisible();
    const save = within(sheet).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription('Fix 1 error to save');
  });
});

describe('automation editor paths in Chromium', () => {
  /** Summary runs only when the diff has text: two ways a run can go. */
  async function withCondition(test: () => Promise<void>) {
    const { nodes } = automation;
    automation.nodes = nodes.map((node) =>
      node.id === 'summary'
        ? { ...node, when: '{{ nodes.diff.output.text !== "" }}' }
        : node,
    );
    try {
      await test();
    } finally {
      automation.nodes = nodes;
    }
  }

  it('lists the paths in a panel under the view switch that stays open while a node is picked', async () =>
    withCondition(async () => {
      await page.viewport(1280, 800);
      renderEditorTab();
      const canvas = await expectWholeCanvas();
      const button = screen.getByRole('button', { name: '2 paths' });
      expect(button).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(button);
      const panel = await screen.findByRole('region', {
        name: 'Possible paths',
      });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', panel.id);
      // Under the view switch, inside the canvas's top-left corner.
      const viewSwitch = screen.getByRole('radiogroup', { name: 'View' });
      const panelBox = panel.getBoundingClientRect();
      const canvasBox = canvas.getBoundingClientRect();
      expect(panelBox.top).toBeGreaterThanOrEqual(
        viewSwitch.getBoundingClientRect().bottom,
      );
      expect(panelBox.left).toBeGreaterThanOrEqual(canvasBox.left);
      expect(panelBox.bottom).toBeLessThanOrEqual(canvasBox.bottom);

      const row = within(panel).getByRole('button', { name: /^Path 2/ });
      await userEvent.click(row);
      expect(row).toHaveAttribute('aria-pressed', 'true');
      // Not a popover: picking a node leaves the list open. (The panel
      // names Pulls too, as a node that ends a run when it fails: the box
      // is picked by its own mark.)
      const pulls = canvas.querySelector<HTMLElement>(
        '[data-flow-node="pulls"]',
      );
      if (pulls === null) throw new Error('no Pulls box');
      await userEvent.click(pulls);
      await screen.findByRole('textbox', { name: 'Code' });
      expect(
        screen.getByRole('region', { name: 'Possible paths' }),
      ).toBeVisible();
      expect(row).toHaveAttribute('aria-pressed', 'true');

      await userEvent.click(
        within(panel).getByRole('button', { name: 'Close' }),
      );
      await vi.waitFor(() =>
        expect(
          screen.queryByRole('region', { name: 'Possible paths' }),
        ).toBeNull(),
      );
      expect(button).toHaveAttribute('aria-expanded', 'false');
    }));

  it('opens the List view on a 375px phone, pins a path from a sheet and leaves a pill to undo it', async () =>
    withCondition(async () => {
      await page.viewport(375, 812);
      renderEditorTab();
      // Narrower than 24rem, the chart is too small to read: the List view
      // says the same, and the view switch says which one is shown.
      await screen.findByRole('list', { name: 'Automation canvas' });
      expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await userEvent.click(screen.getByRole('button', { name: '2 paths' }));
      const sheet = await screen.findByRole('dialog', {
        name: 'Possible paths',
      });
      await userEvent.click(
        within(sheet).getByRole('button', { name: /^Path 2/ }),
      );
      await vi.waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: 'Possible paths' }),
        ).toBeNull(),
      );
      const pill = await screen.findByText(/^Path 2 · /);
      expect(pill).toBeVisible();
      await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
      await vi.waitFor(() =>
        expect(screen.queryByText(/^Path 2 · /)).toBeNull(),
      );
    }));

  it.each([375, 390])(
    'keeps every canvas verb at least 24px on a %ipx phone',
    async (width) =>
      withCondition(async () => {
        await page.viewport(width, 812);
        renderEditorTab();
        await screen.findByRole('button', { name: 'Test run' });
        const verbs = [
          screen.getByRole('radio', { name: 'Canvas' }),
          screen.getByRole('radio', { name: 'List' }),
          screen.getByRole('button', { name: '2 paths' }),
          screen.getByRole('button', { name: 'Edit with your coding agent' }),
          screen.getByRole('button', { name: 'Test run' }),
        ];
        for (const verb of verbs) {
          const box = verb.getBoundingClientRect();
          expect(box.width, verb.textContent ?? '').toBeGreaterThanOrEqual(24);
          expect(box.height, verb.textContent ?? '').toBeGreaterThanOrEqual(24);
          expect(box.right).toBeLessThanOrEqual(width);
        }
      }),
  );
});
