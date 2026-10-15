import { viewportAtRest } from '@tale/ui/testing/flow';
import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { ratioAgainst } from '@/tests/utils/contrast';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { flowCompareFromOverlays } from './compare/compare';
import { buildPlaybackTimeline } from './playback/build-timeline';
import type { FlowRunOverlay } from './playback/types';
import {
  branchFlowGraph,
  branchRunOverlay,
  branchRunOverlayB,
  triageExplainedRun,
  triageFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph, FlowLayout } from './types';
import { WorkflowCanvas, type WorkflowCanvasProps } from './workflow-canvas';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
});

function Canvas(props: Partial<WorkflowCanvasProps> & { graph: FlowGraph }) {
  return (
    <div style={{ width: 1100, height: 1500 }}>
      <WorkflowCanvas
        aria-label="Workflow"
        layoutKey={`compare-${props.graph.nodes.length}`}
        fitPolicy="all"
        {...props}
      />
    </div>
  );
}

/** Renders and resolves once the layout and every line are on the page. */
async function renderCanvas(
  props: Partial<WorkflowCanvasProps> & { graph: FlowGraph },
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
  await waitFor(() =>
    expect(
      view.container.querySelectorAll('path[data-flow-edge]'),
    ).toHaveLength(props.graph.edges.filter((edge) => !edge.layoutOnly).length),
  );
  await viewportAtRest();
  return {
    ...view,
    rerun: (more: Partial<WorkflowCanvasProps>) =>
      view.rerender(<Canvas {...props} {...more} />),
  };
}

const node = (id: string) =>
  document.querySelector<HTMLElement>(`[data-flow-node="${CSS.escape(id)}"]`);
const side = (id: string, run: 'a' | 'b') =>
  node(id)?.querySelector<HTMLElement>(`[data-flow-compare-side="${run}"]`);
const look = (id: string) =>
  document
    .querySelector(`path[data-flow-edge="${CSS.escape(id)}"]`)
    ?.getAttribute('data-look');
const label = (id: string) =>
  document.querySelector(`[data-flow-edge-label="${CSS.escape(id)}"]`)
    ?.textContent;

const compared = () =>
  flowCompareFromOverlays(
    branchFlowGraph(),
    branchRunOverlay(),
    branchRunOverlayB(),
    { absent: { b: ['low'] } },
  );

describe('WorkflowCanvas comparing two runs', () => {
  it('shows each run on every box’s foot, and rings where they differ', async () => {
    await renderCanvas({ graph: branchFlowGraph(), compare: compared() });
    expect(side('notify', 'a')).toHaveAttribute('data-state', 'failed');
    expect(side('notify', 'a')?.textContent).toBe(
      'AThe mail server refused the message',
    );
    expect(side('notify', 'b')).toHaveAttribute('data-state', 'succeeded');
    expect(side('notify', 'b')?.textContent).toBe('B300 ms');
    expect(node('notify')).toHaveAttribute('data-flow-differs', 'true');
    expect(
      node('notify')?.querySelector('[data-slot="flow-node-differs"]'),
    ).toHaveAttribute('title', 'Differs');
    // Neither run's state takes the box over.
    expect(node('notify')).not.toHaveAttribute('data-flow-state');
    expect(
      node('notify')?.querySelector('[data-slot="flow-node-failed"]'),
    ).toBeNull();
    // Alike in both: no ring, no glyph.
    expect(side('fetch', 'a')?.textContent).toBe('A390 ms');
    expect(side('fetch', 'b')?.textContent).toBe('B410 ms');
    expect(node('fetch')).not.toHaveAttribute('data-flow-differs');
    expect(
      screen.getByRole('button', { name: 'Notify (Differs)' }),
    ).toHaveAccessibleDescription(
      /A: The mail server refused the message\. B: Succeeded · 300 ms\./,
    );
  });

  it('dashes a box one run’s version lacks, and says which', async () => {
    await renderCanvas({ graph: branchFlowGraph(), compare: compared() });
    expect(node('low')).toHaveAttribute('data-flow-absent', 'true');
    expect(node('low')).not.toHaveAttribute('data-flow-differs');
    expect(getComputedStyle(node('low') as Element).borderStyle).toBe('dashed');
    expect(
      node('low')?.querySelector('[data-flow-compare-absent]')?.textContent,
    ).toBe("Not in B's version");
    expect(
      screen.getByRole('button', { name: "Low (Not in B's version)" }),
    ).toBeInTheDocument();
  });

  it('gives each run its own decision where they decided apart', async () => {
    await renderCanvas({ graph: branchFlowGraph(), compare: compared() });
    const chips = node('__gate:urgent')?.querySelectorAll<HTMLElement>(
      '[data-flow-compare-decision]',
    );
    expect([...(chips ?? [])].map((chip) => chip.textContent)).toEqual([
      'A',
      '·B',
    ]);
    // A condition only one run asked shows that run's decision.
    expect(
      node('__gate:normal')?.querySelector('[data-slot="flow-gate-decision"]')
        ?.textContent,
    ).toBe('Yes');
  });

  it('weighs each line by the runs that took it, and says which run alone took one', async () => {
    await renderCanvas({ graph: branchFlowGraph(), compare: compared() });
    expect(look('fetch>classify')).toBe('emphasis');
    expect(look('__gate:normal>low')).toBe('quiet');
    expect(look('fetch>urgent')).toBe('base');
    expect(label('__gate:urgent>urgent')).toBe('Yes · Only in B');
    expect(label('__gate:urgent>__gate:normal')).toBe('No · Only in A');
    // A line with no pill says it to a pointer resting on it.
    const note = document.querySelector(
      '[data-flow-edge-group="fetch>urgent"] path[data-flow-edge-note]',
    );
    expect(note).toHaveAttribute('data-flow-edge-note', 'Only in B');
    expect(note?.querySelector('title')?.textContent).toBe('Only in B');
    // A Yes or No pill is wide enough for its words.
    const pill = document.querySelector<HTMLElement>(
      '[data-flow-edge-label="__gate:urgent>urgent"]',
    );
    expect(pill?.scrollWidth).toBeLessThanOrEqual((pill?.clientWidth ?? 0) + 1);
  });

  it('explains its marks in the legend', async () => {
    await renderCanvas({ graph: branchFlowGraph(), compare: compared() });
    await userEvent.click(screen.getByRole('button', { name: 'Legend' }));
    const legend = await screen.findByRole('dialog');
    expect(
      within(legend).getByText('Ring: differs between the runs'),
    ).toBeVisible();
    expect(
      within(legend).getByText('Label on a line: only one run went this way'),
    ).toBeVisible();
  });

  it('shows the comparison in place of a run, and warns the host that passed both', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await renderCanvas({
        graph: branchFlowGraph(),
        overlay: branchRunOverlay(),
        compare: compared(),
      });
      expect(side('notify', 'b')?.textContent).toBe('B300 ms');
      expect(node('notify')).not.toHaveAttribute('data-flow-state');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('comparison in place of a run'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('says the same in the List view', async () => {
    render(
      <Canvas graph={branchFlowGraph()} compare={compared()} view="list" />,
    );
    const notify = screen.getByRole('button', { name: 'Notify (Differs)' });
    expect(notify).toHaveAccessibleDescription(
      /^A: The mail server refused the message B: Succeeded · 300 ms/,
    );
    expect(
      notify.querySelector('[data-flow-compare-side="a"]'),
    ).toHaveAttribute('data-state', 'failed');
    expect(
      notify.querySelector('[data-slot="flow-row-differs"]'),
    ).not.toBeNull();
  });

  it.each(['light', 'dark'])(
    'keeps every word of the comparison readable, and passes axe (%s)',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = await renderCanvas({
        graph: branchFlowGraph(),
        compare: compared(),
      });
      // The chart fades in when it lands: judge it once it has.
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished),
      );
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
        '[data-flow-compare-side], [data-flow-compare-absent], [data-flow-compare-decision]',
      ))
        expect(
          ratioAgainst(element, getComputedStyle(element).color),
          `${theme} ${element.textContent}`,
        ).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe('WorkflowCanvas explaining a run', () => {
  const explained = (): FlowRunOverlay => {
    const overlay = branchRunOverlay();
    return {
      ...overlay,
      nodes: {
        ...overlay.nodes,
        urgent: {
          state: 'skipped',
          reason: 'Skipped: the condition is false',
          explanation: 'Skipped because urgent of Classify (false) is not true',
        },
        '__gate:urgent': {
          state: 'succeeded',
          decision: false,
          explanation: 'Decided No: urgent of Classify was false',
        },
      },
    };
  };

  it('says why in a node’s tooltip and its description', async () => {
    await renderCanvas({ graph: branchFlowGraph(), overlay: explained() });
    const urgent = screen.getByRole('button', { name: 'Urgent (Skipped)' });
    expect(urgent).toHaveAccessibleDescription(
      /^Node 5 of 13\. Skipped: the condition is false\. Skipped because urgent of Classify \(false\) is not true\./,
    );
    await userEvent.hover(urgent);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(
      'Skipped because urgent of Classify (false) is not true',
    );
    // A pointer that jumps away leaves Radix's grace area behind it: close
    // the tip the way a keyboard does.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    // A condition's tooltip keeps its full words, then says how it decided.
    await userEvent.hover(node('__gate:urgent') as HTMLElement);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('tooltip')
          .map((tooltip) => tooltip.textContent)
          .join('\n'),
      ).toMatch(
        /urgent of Classify is true.*Decided No: urgent of Classify was false/,
      ),
    );
  });

  it('keeps the focus on a node whose explanation arrives as the run plays', async () => {
    const run = triageExplainedRun();
    const timeline = buildPlaybackTimeline(run);
    const before = timeline.fromReal(run.startedAt + 4_500);
    const { rerun } = await renderCanvas({
      graph: triageFlowGraph(),
      playback: { timeline, t: before },
    });
    const score = node('score');
    if (score === null) throw new Error('no Score');
    score.focus();
    expect(score).not.toHaveAccessibleDescription(/prompt was too long/);
    rerun({ playback: { timeline, t: timeline.duration } });
    await waitFor(() =>
      expect(node('score')).toHaveAccessibleDescription(
        /the prompt was too long/,
      ),
    );
    expect(node('score')).toBe(score);
    expect(document.activeElement).toBe(score);
  });

  it('adds the explanation to the List view, a condition’s to the node it guards', () => {
    render(
      <Canvas graph={branchFlowGraph()} overlay={explained()} view="list" />,
    );
    const urgent = screen.getByRole('button', { name: 'Urgent (Skipped)' });
    expect(urgent).toHaveAccessibleDescription(
      /^Skipped: the condition is false Skipped because urgent of Classify \(false\) is not true .*Decided No: urgent of Classify was false/,
    );
  });
});
