import '@testing-library/jest-dom/vitest';
import type { FlowLayout, FlowRect } from '@tale/ui/flow/types';
import {
  assertLabelsClear,
  assertRoutesAxisAligned,
  edgeBoxCrossings,
  flowRowOrderFlips,
  viewportAtRest,
} from '@tale/ui/testing/flow';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';

import type { Automation } from '@/lib/engine/core/types';
import { i18n } from '@/lib/i18n/i18n';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import githubTriage from '../../../../../../configs/platform/custom/automations/github/triage-issues/workflow.yml';
import gmailTriage from '../../../../../../configs/platform/custom/automations/gmail/triage-inbox/workflow.yml';
import { mergeNodeTypes } from '../hooks/backend';
import { nodeCatalogView } from '../lib/node-face';
import { AutomationCanvas } from './automation-canvas';

import '@/app/globals.css';

/**
 * The automation canvas in a real browser, on the automations Tale ships:
 * the document becomes a graph in the reader's words, `@tale/ui` lays it
 * out and draws it. Here the shipped documents themselves are measured —
 * their own words size the boxes, conditions and labels — so a line that
 * runs through a box, a label over a line, or a row that swaps sides on an
 * edit shows up here first.
 */

afterEach(async () => {
  cleanup();
  document.documentElement.classList.remove('dark');
  window.localStorage.removeItem('tale:flow-view');
  await cdp().send('Emulation.setEmulatedMedia', { features: [] });
});

const CATALOG = nodeCatalogView(
  mergeNodeTypes([
    {
      type: 'github.list_issues',
      kind: 'connector',
      description: 'List issues',
      allowedFields: ['input'],
      requiredFields: [],
      outputKind: 'structured',
      connector: 'github',
      title: 'List issues',
    },
  ]),
  [{ name: 'github', displayName: 'GitHub' }],
);

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack, parsed at build time; the engine's corpus test validates it
const TRIAGE = githubTriage as Automation;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
const INBOX = gmailTriage as Automation;

function Harness({
  automation,
  layoutKey = 'triage:latest',
  onLayout,
  changed,
}: {
  automation: Automation;
  layoutKey?: string;
  onLayout: (layout: FlowLayout) => void;
  changed?: { ids: ReadonlySet<string>; key: string | number };
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div>
      <button type="button">Before the canvas</button>
      <div style={{ width: 1180, height: 1500 }}>
        <AutomationCanvas
          automation={automation}
          layoutKey={layoutKey}
          catalog={CATALOG}
          selectedId={selected}
          onSelect={setSelected}
          inspectorId="inspector"
          onLayout={onLayout}
          {...(changed !== undefined && { changed })}
        />
      </div>
      <p data-testid="selected">{selected ?? ''}</p>
    </div>
  );
}

/** Renders a document and waits until it is laid out, drawn and at rest. */
async function renderLaidOut(automation: Automation) {
  await page.viewport(1280, 1600);
  const layouts: FlowLayout[] = [];
  const onLayout = (layout: FlowLayout) => layouts.push(layout);
  const view = render(<Harness automation={automation} onLayout={onLayout} />);
  await expectLaidOut(view.container, layouts, 1);
  const rerender = (
    next: Automation,
    changed?: { ids: ReadonlySet<string>; key: string | number },
  ) =>
    view.rerender(
      <Harness
        automation={next}
        onLayout={onLayout}
        {...(changed !== undefined && { changed })}
      />,
    );
  return { ...view, layouts, rerender };
}

/** The chart is done: `count` layouts landed, the frame is no longer busy,
 *  every drawn line is on the page and the view has come to rest. */
async function expectLaidOut(
  container: HTMLElement,
  layouts: readonly FlowLayout[],
  count: number,
) {
  await waitFor(() => expect(layouts.length).toBeGreaterThanOrEqual(count), {
    timeout: 20_000,
  });
  const chart = await waitFor(() => {
    const element = container.querySelector('[data-flow-engine]');
    if (element === null) throw new Error('no chart yet');
    return element;
  });
  await waitFor(() => expect(chart).toHaveAttribute('aria-busy', 'false'));
  const layout = layouts.at(-1);
  await waitFor(
    () =>
      expect(
        container.querySelectorAll('path[data-flow-edge]').length,
      ).toBeGreaterThanOrEqual(Object.keys(layout?.edges ?? {}).length - 2),
    { timeout: 10_000 },
  );
  await viewportAtRest(container);
  return chart;
}

/** The view's translate and scale, from React Flow's viewport element. */
function viewTransform(container: HTMLElement) {
  const viewport = container.querySelector<HTMLElement>(
    '.react-flow__viewport',
  );
  const match = /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
    viewport?.style.transform ?? '',
  );
  if (match === null) throw new Error('no viewport transform');
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

/** Every box the page draws (nodes, conditions, Start, End and frame
 *  headers), mapped back to the layout's coordinates. */
function renderedBoxes(container: HTMLElement) {
  const pane = container.querySelector('.react-flow')?.getBoundingClientRect();
  if (pane === undefined) throw new Error('no pane');
  const { x, y, zoom } = viewTransform(container);
  const toFlow = (rect: DOMRect): FlowRect => ({
    x: (rect.left - pane.left - x) / zoom,
    y: (rect.top - pane.top - y) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  });
  const boxes: Array<{ id: string; rect: FlowRect }> = [];
  for (const button of container.querySelectorAll<HTMLElement>(
    '[data-flow-node]',
  )) {
    boxes.push({
      id: button.dataset.flowNode ?? '',
      rect: toFlow(button.getBoundingClientRect()),
    });
  }
  container
    .querySelectorAll<HTMLElement>('[data-slot="flow-frame-header"]')
    .forEach((header, index) => {
      boxes.push({
        id: `header:${index}`,
        rect: toFlow(header.getBoundingClientRect()),
      });
    });
  return boxes;
}

describe('AutomationCanvas in Chromium', () => {
  it('draws Triage GitHub issues with Start above, End below and no line through a box', async () => {
    const { container, layouts } = await renderLaidOut(TRIAGE);
    const layout = layouts.at(-1) as FlowLayout;
    const boxes = renderedBoxes(container);
    expect(edgeBoxCrossings(layout.edges, boxes)).toEqual([]);
    assertRoutesAxisAligned(layout);
    assertLabelsClear(layout);

    const rectOf = (id: string) => {
      const box = boxes.find((candidate) => candidate.id === id);
      if (box === undefined) throw new Error(`no box ${id}`);
      return box.rect;
    };
    const start = rectOf('__start');
    const end = rectOf('__end');
    for (const id of TRIAGE.nodes.map((node) => node.id)) {
      const box = rectOf(id);
      expect(box.y, `${id} below Start`).toBeGreaterThan(
        start.y + start.height,
      );
      expect(box.y + box.height, `${id} above End`).toBeLessThan(end.y);
    }
    // Score walks the issues in a frame of its own, named in words.
    expect(
      container.querySelector('[data-slot="flow-frame-header"]'),
    ).toHaveTextContent('For each item of issues of Open issues');
    // Start says what a run receives; End what it returns.
    expect(
      screen.getByRole('button', { name: /^Start/ }),
    ).toHaveAccessibleDescription(/owner/);
    expect(screen.getByRole('button', { name: /^End/ })).toBeVisible();
  });

  it.each(['en', 'de', 'fr'])(
    'keeps the condition and its labels clear of every line in %s',
    async (locale) => {
      const previous = i18n.language;
      await i18n.changeLanguage(locale);
      try {
        const { container, layouts } = await renderLaidOut(INBOX);
        const layout = layouts.at(-1) as FlowLayout;
        expect(
          edgeBoxCrossings(layout.edges, renderedBoxes(container)),
        ).toEqual([]);
        assertLabelsClear(layout);
        // The condition reads as words, above Triage.
        const gate = container.querySelector<HTMLElement>(
          '[data-flow-node="__gate:triage"]',
        );
        const triage = container.querySelector<HTMLElement>(
          '[data-flow-node="triage"]',
        );
        if (gate === null || triage === null) throw new Error('no gate');
        expect(gate.getBoundingClientRect().bottom).toBeLessThan(
          triage.getBoundingClientRect().top,
        );
        expect(gate).not.toHaveTextContent('{{');
      } finally {
        cleanup();
        await i18n.changeLanguage(previous);
      }
    },
  );

  it('is one Tab stop: Start first, the arrows follow the lines, Enter opens', async () => {
    await renderLaidOut(TRIAGE);
    screen.getByRole('button', { name: 'Before the canvas' }).focus();
    await userEvent.keyboard('{Tab}');
    const start = screen.getByRole('button', { name: /^Start/ });
    await waitFor(() => expect(start).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    const issues = screen.getByRole('button', { name: /^Issues/ });
    await waitFor(() => expect(issues).toHaveFocus());
    // Each box says what it is and what it reads.
    expect(issues).toHaveAccessibleDescription(
      /run input \(owner, repo, limit\)/,
    );
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('selected')).toHaveTextContent('issues');
    await userEvent.keyboard('{End}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^End/ })).toHaveFocus(),
    );
  });

  it('glides to a structural edit without swapping any row', async () => {
    const { container, layouts, rerender } = await renderLaidOut(TRIAGE);
    rerender({
      ...TRIAGE,
      nodes: [
        ...TRIAGE.nodes,
        {
          id: 'archive',
          type: 'transform',
          input: { report: '{{ nodes.report.output }}' },
          code: 'return input.report;',
        },
      ],
    });
    await waitFor(() => expect(layouts.length).toBe(2), { timeout: 20_000 });
    const chart = container.querySelector('[data-flow-engine]');
    await waitFor(() =>
      expect(chart).toHaveAttribute('data-flow-transition', 'move'),
    );
    const [before, after] = layouts as [FlowLayout, FlowLayout];
    expect(flowRowOrderFlips(before, after)).toEqual([]);
    const issues = container.querySelector<HTMLElement>(
      '.react-flow__node[data-id="issues"]',
    );
    expect(getComputedStyle(issues as Element).transitionDuration).toBe('0.3s');
    await waitFor(
      () => expect(chart).not.toHaveAttribute('data-flow-transition'),
      { timeout: 2_000 },
    );
    expect(
      container.querySelector('[data-flow-node="archive"]'),
    ).not.toBeNull();
  });

  it('jumps to an edit made elsewhere under reduced motion, without a ring', async () => {
    await cdp().send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const { container, layouts, rerender } = await renderLaidOut(TRIAGE);
    const nodes = TRIAGE.nodes.slice(0, -1);
    rerender({ ...TRIAGE, nodes }, { ids: new Set(['score']), key: 3 });
    await waitFor(() => expect(layouts.length).toBe(2), { timeout: 20_000 });
    await waitFor(() =>
      expect(container.querySelector('[data-flow-node="report"]')).toBeNull(),
    );
    const chart = container.querySelector('[data-flow-engine]');
    expect(chart).not.toHaveAttribute('data-flow-transition');
    expect(
      container.querySelector('[data-slot="flow-node-changed"]'),
    ).toBeNull();
  });

  it.each(['light', 'dark'])(
    'reads at AA in %s with a path pinned from the Paths panel',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      const { container } = await renderLaidOut(INBOX);
      await userEvent.click(screen.getByRole('button', { name: /paths$/ }));
      const panel = await screen.findByRole('region', {
        name: 'Possible paths',
      });
      const [first] = within(
        within(panel).getByRole('group', { name: 'Possible paths' }),
      ).getAllByRole('button');
      if (first === undefined) throw new Error('No path rows');
      await userEvent.click(first);
      await waitFor(() =>
        expect(first).toHaveAttribute('aria-pressed', 'true'),
      );
      // Colours are judged at rest.
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().endTime !== Infinity,
          )
          .map((animation) => animation.finished),
      );
      const chart = container.querySelector('[data-flow-engine]');
      if (!(chart instanceof HTMLElement)) throw new Error('no chart');
      const result = await axe.run(chart, {
        runOnly: [
          'color-contrast',
          'aria-allowed-attr',
          'aria-valid-attr-value',
          'button-name',
          'nested-interactive',
        ],
      });
      expect(result.violations).toEqual([]);
    },
  );
});
