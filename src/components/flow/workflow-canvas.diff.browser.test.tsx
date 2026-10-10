import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { Tag } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { diffHighlight, mergeFlowGraphs, type FlowNodeDiff } from './diff/diff';
import { pointAlongRoute } from './layout/geometry';
import { flowNodeSize, measureFlowText } from './layout/sizes';
import { branchFlowGraph, branchRunOverlay } from './testing/flow-fixtures';
import type {
  FlowEdge,
  FlowGraph,
  FlowLayout,
  FlowNode,
  FlowRect,
} from './types';
import { validateFlowGraph } from './validate-graph';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const line = (source: string, target: string, kind: FlowEdge['kind']) => ({
  id: `${source}>${target}`,
  source,
  target,
  kind,
});

/** The branch chart as it was: Merge still called Combine. */
function olderVersion(): FlowGraph {
  const graph = branchFlowGraph();
  const id = (value: string) => (value === 'merge' ? 'combine' : value);
  return {
    nodes: graph.nodes.map((node) =>
      node.id === 'merge'
        ? Object.assign({}, node, { id: 'combine', label: 'Combine' })
        : node,
    ),
    edges: graph.edges.map((edge) =>
      Object.assign({}, edge, {
        id: `${id(edge.source)}>${id(edge.target)}`,
        source: id(edge.source),
        target: id(edge.target),
      }),
    ),
    groups: graph.groups ?? [],
  };
}

/** The branch chart as it is now: a Tag step after Classify, no Low, the
 *  Normal condition only an "only if", Poll no longer repeating. */
function newerVersion(): FlowGraph {
  const graph = branchFlowGraph();
  const nodes: FlowNode[] = [];
  for (const node of graph.nodes) {
    if (node.id === 'low') continue;
    nodes.push(
      node.id === '__gate:normal'
        ? Object.assign({}, node, { mode: 'only-if' })
        : node,
    );
    if (node.id === 'classify')
      nodes.push({
        id: 'tag',
        kind: 'step',
        label: 'Tag',
        icon: Tag,
        typeLabel: 'Language model · claude-haiku-4-5',
        reads: [{ id: 'classify', label: 'Classify' }],
      });
  }
  const edges: FlowEdge[] = graph.edges
    .filter((edge) => edge.source !== 'low' && edge.target !== 'low')
    .map((edge) =>
      edge.id === '__gate:normal>normal'
        ? line('__gate:normal', 'normal', 'gate')
        : edge,
    );
  edges.push(line('classify', 'tag', 'data'), line('tag', 'merge', 'data'));
  return { nodes, edges, groups: [] };
}

const SAID: Readonly<Record<string, FlowNodeDiff>> = {
  classify: { kind: 'changed', summary: 'Prompt and model changed' },
  merge: { kind: 'renamed', renamedFrom: 'Combine', beforeId: 'combine' },
  '__gate:normal': { kind: 'changed', summary: 'Now only if' },
  poll: { kind: 'changed', summary: 'Repeats no more' },
};

const versions = () =>
  mergeFlowGraphs(olderVersion(), newerVersion(), (id) => SAID[id]);

function Canvas(props: Partial<WorkflowCanvasProps> & { graph: FlowGraph }) {
  return (
    <div style={{ width: 1100, height: 1600 }}>
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey={`diff-${props.diff === undefined ? 'plain' : 'versions'}`}
        fitPolicy="all"
        {...props}
      />
    </div>
  );
}

/** Renders and resolves once the layout and every line are on the page,
 *  the chart's fade-in done. */
async function renderCanvas(
  props: Partial<WorkflowCanvasProps> & { graph: FlowGraph },
) {
  await page.viewport(1280, 1700);
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
  await waitFor(() =>
    expect(
      view.container.querySelectorAll('path[data-flow-edge]'),
    ).toHaveLength(props.graph.edges.filter((edge) => !edge.layoutOnly).length),
  );
  await viewportAtRest();
  await Promise.all(
    document
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getTiming().iterations !== Infinity,
      )
      .map((animation) => animation.finished),
  );
  return { ...view, layout: layout as unknown as FlowLayout };
}

const node = (id: string) =>
  document.querySelector<HTMLElement>(`[data-flow-node="${CSS.escape(id)}"]`);
const edgePath = (id: string) =>
  document.querySelector<SVGPathElement>(
    `path[data-flow-edge="${CSS.escape(id)}"]`,
  );
const edgeLabel = (id: string) =>
  document.querySelector<HTMLElement>(
    `[data-flow-edge-label="${CSS.escape(id)}"]`,
  );
const badge = (holder: Element | null) =>
  holder?.querySelector('[data-slot="change-kind-badge"]')?.textContent;

/** A token's colour as the page resolves it. */
function tokenColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** Each node's box as the page draws it, mapped back to flow coordinates. */
function renderedBoxes(container: HTMLElement): Map<string, FlowRect> {
  const pane = container.querySelector('.react-flow')?.getBoundingClientRect();
  const viewport = container.querySelector<HTMLElement>(
    '.react-flow__viewport',
  );
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
    viewport?.style.transform ?? '',
  );
  if (pane === undefined || match === null) throw new Error('no viewport');
  const [x, y, zoom] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const boxes = new Map<string, FlowRect>();
  for (const button of container.querySelectorAll<HTMLElement>(
    '[data-flow-node]',
  )) {
    const rect = button.getBoundingClientRect();
    boxes.set(button.dataset.flowNode ?? '', {
      x: (rect.left - pane.left - x) / zoom,
      y: (rect.top - pane.top - y) / zoom,
      width: rect.width / zoom,
      height: rect.height / zoom,
    });
  }
  return boxes;
}

describe('WorkflowCanvas comparing two versions', () => {
  it('merges into a graph the canvas can draw', () => {
    const { graph, diff } = versions();
    expect(() => validateFlowGraph(graph)).not.toThrow();
    expect(diff.nodes).toMatchObject({
      tag: { kind: 'added' },
      low: { kind: 'removed' },
    });
  });

  it('frames each box in its change’s colour with a badge in words', async () => {
    const { graph, diff } = versions();
    await renderCanvas({ graph, diff });
    const added = node('tag');
    expect(added).toHaveAttribute('data-flow-diff', 'added');
    expect(badge(added)).toBe('Added');
    expect(getComputedStyle(added as Element).borderTopWidth).toBe('2px');
    expect(getComputedStyle(added as Element).borderTopColor).toBe(
      tokenColor('var(--diff-added)'),
    );
    // Removed: red, hatched, its title struck through.
    const removed = node('low');
    expect(badge(removed)).toBe('Removed');
    expect(getComputedStyle(removed as Element).borderTopColor).toBe(
      tokenColor('var(--diff-removed)'),
    );
    expect(getComputedStyle(removed as Element).backgroundImage).toContain(
      'repeating-linear-gradient',
    );
    const struck = removed?.querySelector('.line-through');
    expect(struck?.textContent).toBe('Low');
    expect(getComputedStyle(struck as Element).textDecorationLine).toBe(
      'line-through',
    );
    // Changed and renamed: amber, the host's words on the foot.
    expect(badge(node('classify'))).toBe('Changed');
    expect(getComputedStyle(node('classify') as Element).borderTopColor).toBe(
      tokenColor('var(--diff-changed)'),
    );
    const strip = (id: string) =>
      node(id)?.querySelector('[data-slot="flow-node-strip"]')?.textContent;
    expect(strip('classify')).toBe('Prompt and model changed');
    expect(badge(node('merge'))).toBe('Renamed');
    expect(strip('merge')).toBe('Was Combine');
    // A condition wears its badge in its pill.
    expect(badge(node('__gate:normal'))).toBe('Changed');
    // What did not change stays as it was, its foot saying what it reads.
    expect(node('fetch')).not.toHaveAttribute('data-flow-diff');
    expect(getComputedStyle(node('fetch') as Element).borderTopWidth).toBe(
      '1px',
    );
    expect(badge(node('fetch'))).toBeUndefined();
    // A frame only the older version had.
    const frame = document.querySelector('[data-flow-frame="repeat:poll"]');
    expect(frame).toHaveAttribute('data-flow-diff', 'removed');
    expect(badge(frame)).toBe('Removed');
  });

  it('draws every box at its size, with the diff and without', async () => {
    const { graph, diff } = versions();
    const plain = await renderCanvas({ graph });
    const without = renderedBoxes(plain.container);
    cleanup();
    const marked = await renderCanvas({ graph, diff });
    const withDiff = renderedBoxes(marked.container);
    for (const each of graph.nodes) {
      // A condition is as wide as its words, measured as the layout does.
      const size = flowNodeSize(each, measureFlowText);
      for (const [label, boxes] of [
        ['without', without],
        ['with', withDiff],
      ] as const) {
        const box = boxes.get(each.id);
        expect(box, `${each.id} ${label}`).toBeDefined();
        expect(
          Math.abs((box?.width ?? 0) - size.width),
          `${each.id} width ${label} the diff`,
        ).toBeLessThan(1);
        expect(
          Math.abs((box?.height ?? 0) - size.height),
          `${each.id} height ${label} the diff`,
        ).toBeLessThan(1);
      }
    }
    // And the same box with the diff as without it.
    for (const [id, box] of withDiff) {
      expect(
        Math.abs(box.width - (without.get(id)?.width ?? 0)),
        id,
      ).toBeLessThan(1);
      expect(
        Math.abs(box.height - (without.get(id)?.height ?? 0)),
        id,
      ).toBeLessThan(1);
    }
    // Every badge fits its row: nothing on a box spills out of it.
    for (const each of document.querySelectorAll<HTMLElement>(
      '[data-flow-node] [data-slot="change-kind-badge"]',
    )) {
      const box = each.closest('[data-flow-node]')?.getBoundingClientRect();
      const rect = each.getBoundingClientRect();
      expect(rect.right).toBeLessThanOrEqual((box?.right ?? 0) + 0.5);
      expect(rect.bottom).toBeLessThanOrEqual((box?.bottom ?? 0) + 0.5);
    }
  });

  it('colours only the lines that changed, each with its sign', async () => {
    const { graph, diff } = versions();
    const { layout } = await renderCanvas({ graph, diff });
    const stroke = (id: string) =>
      getComputedStyle(edgePath(id) as Element).stroke;
    expect(edgePath('classify>tag')).toHaveAttribute('data-diff', 'added');
    expect(stroke('classify>tag')).toBe(tokenColor('var(--diff-added)'));
    expect(stroke('fetch>low')).toBe(tokenColor('var(--diff-removed)'));
    // Every other line in the plain line colour, a Yes or No too.
    const plain = tokenColor('hsl(var(--muted-foreground))');
    expect(stroke('fetch>classify')).toBe(plain);
    expect(stroke('__gate:urgent>urgent')).toBe(plain);
    expect(edgeLabel('__gate:urgent>urgent')?.textContent).toBe('Yes');
    expect(
      getComputedStyle(edgeLabel('__gate:urgent>urgent') as Element).color,
    ).toBe(plain);
    // A line without a pill carries its sign at its middle.
    const sign = document.querySelector('[data-flow-edge-sign="classify>tag"]');
    expect(sign).toHaveAttribute('data-diff', 'added');
    expect(sign).toHaveAttribute('aria-hidden', 'true');
    const middle = pointAlongRoute(
      layout.edges['classify>tag']?.points ?? [],
      0.5,
    );
    expect(sign?.getAttribute('transform')).toBe(
      `translate(${middle?.x} ${middle?.y})`,
    );
    expect(
      document
        .querySelector('[data-flow-edge-sign="fetch>low"]')
        ?.getAttribute('data-diff'),
    ).toBe('removed');
    // A Yes or No line carries it in its own pill, sized for it.
    expect(edgeLabel('__gate:normal>low')?.textContent).toBe('− No');
    expect(edgeLabel('__gate:normal>normal~before')?.textContent).toBe('− Yes');
    expect(
      document.querySelector('[data-flow-edge-sign="__gate:normal>low"]'),
    ).toBeNull();
    const pill = edgeLabel('__gate:normal>low');
    expect(pill?.scrollWidth).toBeLessThanOrEqual((pill?.clientWidth ?? 0) + 1);
    // A pointer resting on a changed line reads what became of it.
    const note = document.querySelector(
      '[data-flow-edge-group="classify>tag"] path[data-flow-edge-note]',
    );
    expect(note?.querySelector('title')?.textContent).toBe('New connection');
    expect(
      document.querySelector(
        '[data-flow-edge-group="fetch>low"] path[data-flow-edge-note] title',
      )?.textContent,
    ).toBe('Removed connection');
  });

  it('names each box with its change, and says the host’s words', async () => {
    const { graph, diff } = versions();
    await renderCanvas({ graph, diff });
    expect(screen.getByRole('button', { name: 'Tag (Added)' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Low (Removed)' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Classify (Changed)' }),
    ).toHaveAccessibleDescription(/Prompt and model changed\./);
    expect(
      screen.getByRole('button', { name: 'Merge (Renamed)' }),
    ).toHaveAccessibleDescription(/Was Combine\./);
    expect(
      screen.getByRole('button', {
        name: 'Condition for Normal: nodes.classify.output.priority === "normal" (Changed)',
      }),
    ).toHaveAccessibleDescription(/Now only if\./);
    expect(screen.getByRole('button', { name: 'Fetch' })).toBeVisible();
    // A condition has no foot: a pointer reads the host's words in its
    // tooltip, under the condition itself.
    await userEvent.hover(node('__gate:normal') as HTMLElement);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('tooltip')
          .map((tooltip) => tooltip.textContent)
          .join('\n'),
      ).toMatch(/priority === "normal".*Now only if/),
    );
  });

  it('explains its marks in the legend', async () => {
    const { graph, diff } = versions();
    await renderCanvas({ graph, diff });
    await userEvent.click(screen.getByRole('button', { name: 'Legend' }));
    const legend = await screen.findByRole('dialog');
    for (const words of [
      'Added in the newer version',
      'Removed in the newer version',
      'Changed or renamed',
      'New connection',
      'Removed connection',
    ])
      expect(within(legend).getByText(words)).toBeVisible();
    // Each line's swatch draws the mark it explains.
    const swatch = within(legend)
      .getByText('Removed in the newer version')
      .closest('li')
      ?.querySelector('span[aria-hidden="true"]');
    expect(getComputedStyle(swatch as Element).borderTopColor).toBe(
      tokenColor('var(--diff-removed)'),
    );
  });

  it('says the same in the List view, a removed row where it stood', () => {
    const { graph, diff } = versions();
    render(<Canvas graph={graph} diff={diff} view="list" />);
    const rows = [
      ...document.querySelectorAll<HTMLElement>('[data-flow-row]'),
    ].map((row) => row.dataset.flowRow);
    expect(rows.indexOf('low')).toBe(rows.indexOf('normal') + 1);
    const low = screen.getByRole('button', { name: 'Low (Removed)' });
    expect(badge(low)).toBe('Removed');
    expect(low.querySelector('.line-through')?.textContent).toBe('Low');
    expect(
      screen.getByRole('button', { name: 'Classify (Changed)' }),
    ).toHaveAccessibleDescription(/^Prompt and model changed/);
    // A changed condition is said on the step it guards.
    expect(
      screen.getByRole('button', { name: 'Normal' }),
    ).toHaveAccessibleDescription(
      /Condition for Normal: nodes\.classify\.output\.priority === "normal" \(Changed\)/,
    );
  });

  it('shows two versions in place of a run, and warns the host that passed both', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { graph, diff } = versions();
      await renderCanvas({ graph, diff, overlay: branchRunOverlay() });
      expect(badge(node('tag'))).toBe('Added');
      expect(document.querySelector('[data-flow-state]')).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('two versions in place of a run'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('brings what changed forward on a version’s own graph, quieting nothing', async () => {
    const after = newerVersion();
    const { diff } = versions();
    await renderCanvas({ graph: after, highlight: diffHighlight(after, diff) });
    expect(node('tag')).toHaveAttribute('data-flow-highlighted', 'default');
    expect(node('classify')).toHaveAttribute(
      'data-flow-highlighted',
      'default',
    );
    expect(node('fetch')).not.toHaveAttribute('data-flow-highlighted');
    expect(document.querySelector('[data-flow-quiet]')).toBeNull();
    expect(edgePath('classify>tag')).toHaveAttribute('data-look', 'emphasis');
  });

  it.each(['light', 'dark'])(
    'keeps every word of the comparison readable, and passes axe (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { graph, diff } = versions();
      const { container } = await renderCanvas({ graph, diff });
      const result = await axe.run(container, {
        runOnly: [
          'color-contrast',
          'aria-allowed-attr',
          'aria-valid-attr-value',
          'button-name',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);
      for (const element of container.querySelectorAll(
        '[data-flow-node] [data-slot="change-kind-badge"], [data-flow-diff] [data-slot="flow-node-strip"], [data-flow-edge-label]',
      ))
        expect(
          ratioAgainst(element, getComputedStyle(element).color),
          `${theme} ${element.textContent}`,
        ).toBeGreaterThanOrEqual(4.5);
      // A frame's colour reads as a border on the card.
      for (const id of ['tag', 'low', 'classify'])
        expect(
          ratioAgainst(
            node(id) as Element,
            getComputedStyle(node(id) as Element).borderTopColor,
          ),
          `${theme} ${id} frame`,
        ).toBeGreaterThanOrEqual(3);
    },
  );

  it('shows its badges at once under reduced motion', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const { graph, diff } = versions();
    await renderCanvas({ graph, diff });
    const moving = document
      .getAnimations()
      .filter(
        (animation) =>
          animation.playState === 'running' &&
          Number(animation.effect?.getComputedTiming().duration) > 1,
      );
    expect(moving).toEqual([]);
    expect(badge(node('tag'))).toBe('Added');
  });

  it('keeps the frames and drops the tints in forced colours', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    const { graph, diff } = versions();
    await renderCanvas({ graph, diff });
    expect(getComputedStyle(node('tag') as Element).borderTopWidth).toBe('2px');
    expect(
      getComputedStyle(document.documentElement)
        .getPropertyValue('--diff-removed-hatch')
        .trim(),
    ).toBe('transparent');
    expect(badge(node('low'))).toBe('Removed');
  });
});
