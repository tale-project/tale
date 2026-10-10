import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import type { i18n as I18n } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Button } from '../primitives/button';
import type { FlowRunOverlay } from './playback/types';
import { branchFlowGraph, triageFlowGraph } from './testing/flow-fixtures';
import { assertLabelsClear } from './testing/flow-geometry';
import type { FlowGraph, FlowLayout } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

/**
 * How the chart looks, measured as Chromium paints it: the accent on Start
 * and End, dashes that still read at half zoom, a problem's frame, a run's
 * frame and the selection telling themselves apart, Yes and No clear of
 * every box in each language, touch targets, and a fit that keeps the
 * first box out from under the top corners' controls.
 */

// The tree holds the language it detected while mounted; each test that
// switches it hands the shared instance back in English.
const shared: { i18n?: I18n } = {};
function CaptureI18n() {
  const { i18n } = useTranslation();
  useEffect(() => {
    shared.i18n = i18n;
  }, [i18n]);
  return null;
}

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
  window.localStorage.removeItem('user-locale');
  await shared.i18n?.changeLanguage('en-US');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
  await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
});

function Canvas({
  width = 1100,
  height = 1500,
  ...props
}: Partial<WorkflowCanvasProps> & {
  graph: FlowGraph;
  width?: number;
  height?: number;
}) {
  const [selected, setSelected] = useState<string | null>(
    props.selectedId ?? null,
  );
  return (
    <div data-testid="frame" style={{ width, height }}>
      <CaptureI18n />
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey={`look-${props.graph.nodes.length}`}
        fitPolicy="all"
        selectedId={selected}
        onSelect={setSelected}
        {...props}
      />
    </div>
  );
}

/** Renders a chart and resolves once its layout is drawn and at rest. */
async function renderChart(
  props: Partial<WorkflowCanvasProps> & {
    graph: FlowGraph;
    width?: number;
    height?: number;
  },
) {
  await page.viewport(1280, 1600);
  let layout: FlowLayout | null = null;
  const view = render(
    <Canvas
      {...props}
      onLayout={(next) => {
        layout = next;
      }}
    />,
  );
  await waitFor(
    () => {
      if (layout === null) throw new Error('not laid out yet');
    },
    { timeout: 20_000 },
  );
  await waitFor(
    () =>
      expect(
        view.container.querySelectorAll('path[data-flow-edge]'),
      ).toHaveLength(
        props.graph.edges.filter((edge) => !edge.layoutOnly).length,
      ),
    { timeout: 10_000 },
  );
  await viewportAtRest();
  // The chart fades in; colours are read once it is fully there.
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) =>
          animation.effect?.getComputedTiming().endTime !== Infinity,
      )
      .map((animation) => animation.finished),
  );
  return { ...view, layout: layout as unknown as FlowLayout };
}

const box = (id: string) =>
  document.querySelector<HTMLElement>(`[data-flow-node="${CSS.escape(id)}"]`);

/** What a CSS colour expression resolves to on the page right now. */
function resolved(property: 'color' | 'backgroundColor', value: string) {
  const probe = document.createElement('span');
  probe.style.setProperty(
    property === 'color' ? 'color' : 'background-color',
    value,
  );
  document.body.append(probe);
  const colour = getComputedStyle(probe)[property];
  probe.remove();
  return colour;
}

const overlaps = (a: DOMRect, b: DOMRect) =>
  a.left < b.right - 1 &&
  a.right > b.left + 1 &&
  a.top < b.bottom - 1 &&
  a.bottom > b.top + 1;

describe('WorkflowCanvas look', () => {
  it.each(['light', 'dark'] as const)(
    'draws Start and End on the accent tile, and dashes that keep 3:1 (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      await renderChart({ graph: branchFlowGraph() });
      const accent = resolved('backgroundColor', 'var(--color-accent-base)');
      for (const id of ['__start', '__end']) {
        const tile = box(id)?.querySelector<HTMLElement>(
          '[data-slot="flow-node-tile"]',
        );
        expect(tile, id).not.toBeNull();
        // The same token in both themes: ink on light, white on dark.
        expect(getComputedStyle(tile as Element).backgroundColor, id).toBe(
          accent,
        );
        const glyph = tile?.querySelector('svg') as Element;
        expect(
          ratioAgainst(tile as Element, getComputedStyle(glyph).color),
          `${id} glyph`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      // A step keeps the plain tile.
      expect(
        getComputedStyle(
          box('fetch')?.querySelector(
            '[data-slot="flow-node-tile"]',
          ) as Element,
        ).backgroundColor,
      ).not.toBe(accent);

      const dashed = [
        ...document.querySelectorAll<HTMLElement>('[data-flow-node]'),
      ].filter((node) => getComputedStyle(node).borderTopStyle === 'dashed');
      expect(dashed.length).toBeGreaterThan(0);
      for (const node of dashed)
        expect(
          ratioAgainst(node, getComputedStyle(node).borderTopColor),
          `${theme} ${node.dataset.flowNode} dashes`,
        ).toBeGreaterThanOrEqual(3);
    },
  );

  it('keeps a problem’s frame, a run’s frame and the selection apart', async () => {
    const issues = new Map([
      ['open_issues', { errors: 1, warnings: 0 }],
      ['score', { errors: 0, warnings: 2 }],
    ]);
    const view = await renderChart({
      graph: triageFlowGraph(),
      issues,
      selectedId: 'score',
    });
    const destructive = resolved('color', 'hsl(var(--destructive))');
    const plain = getComputedStyle(box('issues') as Element).borderTopColor;
    const error = getComputedStyle(box('open_issues') as Element);
    const warning = getComputedStyle(box('score') as Element);
    expect(error.borderTopColor).toBe(destructive);
    // Amber, not the plain border and not the error red.
    expect(warning.borderTopColor).not.toBe(plain);
    expect(warning.borderTopColor).not.toBe(destructive);
    // The selected node keeps its problem's frame and adds the ring.
    expect(warning.boxShadow).not.toBe('none');
    expect(error.boxShadow).not.toContain(
      resolved('color', 'hsl(var(--ring))'),
    );
    view.unmount();

    const overlay: FlowRunOverlay = {
      finished: false,
      nodes: {
        issues: { state: 'succeeded' },
        open_issues: { state: 'failed' },
        score: { state: 'running' },
      },
    };
    await renderChart({ graph: triageFlowGraph(), overlay });
    expect(getComputedStyle(box('open_issues') as Element).borderTopColor).toBe(
      destructive,
    );
    expect(
      box('open_issues')?.querySelector('[data-slot="flow-node-failed"]'),
    ).not.toBeNull();
    expect(getComputedStyle(box('score') as Element).borderTopColor).toBe(
      resolved('color', 'hsl(var(--info-foreground))'),
    );
    expect(getComputedStyle(box('issues') as Element).borderTopColor).toBe(
      plain,
    );
  });

  it.each([
    ['de', 'Ja', 'Nein'],
    ['fr', 'Oui', 'Non'],
    ['en', 'Yes', 'No'],
  ])(
    'keeps Yes and No clear of every box in %s, and conditions inside their width',
    async (locale, yes, no) => {
      window.localStorage.setItem('user-locale', locale);
      const { container, layout } = await renderChart({
        graph: branchFlowGraph(),
      });
      const labels = [
        ...container.querySelectorAll<HTMLElement>('[data-flow-edge-label]'),
      ];
      expect(labels.map((label) => label.textContent).sort()).toEqual(
        [yes, yes, no, no].sort(),
      );
      assertLabelsClear(layout);
      const boxes = [
        ...container.querySelectorAll<HTMLElement>('[data-flow-node]'),
      ];
      for (const label of labels) {
        const rect = label.getBoundingClientRect();
        // The pill holds its word on one line.
        expect(label.scrollWidth, label.textContent ?? '').toBeLessThanOrEqual(
          label.clientWidth + 1,
        );
        for (const node of boxes)
          expect(
            overlaps(rect, node.getBoundingClientRect()),
            `${label.textContent} over ${node.dataset.flowNode}`,
          ).toBe(false);
      }
      // Each condition is as wide as its words need, inside 160 to 288 px.
      for (const [id, rect] of Object.entries(layout.nodes))
        if (id.startsWith('__gate:')) {
          expect(rect.width, id).toBeGreaterThanOrEqual(160);
          expect(rect.width, id).toBeLessThanOrEqual(288);
        }
    },
  );

  it('keeps the first box clear of the top corners’ controls when it fits', async () => {
    await renderChart({
      graph: triageFlowGraph(),
      width: 640,
      height: 420,
      fitPolicy: 'auto',
      topStart: <Button size="sm">Canvas</Button>,
      topEnd: (
        <Button size="sm" variant="secondary">
          Paths
        </Button>
      ),
    });
    const corner = screen
      .getByRole('button', { name: 'Paths' })
      .closest('.react-flow__panel')
      ?.getBoundingClientRect();
    const start = box('__start')?.getBoundingClientRect();
    expect(corner).toBeDefined();
    expect(start?.top ?? 0).toBeGreaterThanOrEqual((corner?.bottom ?? 0) + 8);
  });

  it('gives every corner control a 44 px target under a coarse pointer, none overlapping', async () => {
    await cdp().send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    await renderChart({
      graph: triageFlowGraph(),
      legend: [{ id: 'data', swatch: { edge: 'data' }, label: 'Data' }],
    });
    const names = ['Zoom in', 'Zoom out', 'Reset view', 'Legend'];
    const targets = names.map((name) => {
      const button = screen.getByRole('button', { name });
      const after = getComputedStyle(button, '::after');
      const rect = button.getBoundingClientRect();
      const top = Number.parseFloat(after.top);
      const left = Number.parseFloat(after.left);
      return {
        name,
        top: rect.top + top,
        bottom: rect.bottom - Number.parseFloat(after.bottom),
        width: rect.width - left - Number.parseFloat(after.right),
        height: rect.height - top - Number.parseFloat(after.bottom),
      };
    });
    for (const target of targets) {
      expect(target.width, target.name).toBeGreaterThanOrEqual(44);
      expect(target.height, target.name).toBeGreaterThanOrEqual(44);
    }
    for (let index = 1; index < targets.length; index++)
      expect(
        targets[index]?.top ?? 0,
        `${names[index]} under ${names[index - 1]}`,
      ).toBeGreaterThanOrEqual((targets[index - 1]?.bottom ?? 0) - 0.5);
  });

  it('lines the List view’s corners up along their tops', async () => {
    await page.viewport(1280, 1600);
    render(
      <Canvas
        graph={triageFlowGraph()}
        view="list"
        topStart={
          <div className="flex flex-col items-start gap-2">
            <Button size="sm">Canvas</Button>
            <div className="h-8 w-40">Path 2</div>
          </div>
        }
        topEnd={
          <Button size="sm" variant="secondary">
            Paths
          </Button>
        }
      />,
    );
    const start = await screen.findByRole('button', { name: 'Canvas' });
    const end = screen.getByRole('button', { name: 'Paths' });
    expect(end.getBoundingClientRect().top).toBeCloseTo(
      start.getBoundingClientRect().top,
      0,
    );
  });
});
