import '@testing-library/jest-dom/vitest';
import { viewportAtRest } from '@tale/ui/testing/flow';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import type {
  RecordedStep,
  RunRecordView,
} from '@/app/lib/backend/contract/automations';
import type { Automation } from '@/lib/engine/core/types';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import githubTriage from '../../../../../../configs/platform/custom/automations/github/triage-issues/workflow.yml';
import { mergeNodeTypes } from '../hooks/backend';
import { nodeCatalogView } from '../lib/node-face';
import type { RunUnitRef } from '../lib/run-timeline';
import { AutomationCanvas, type CanvasRun } from './automation-canvas';

import '@/app/globals.css';

/**
 * A recorded run played back on the automation canvas in a real browser:
 * the run's record becomes moments on the shipped Triage GitHub issues
 * chart, the chart opens on the run's end, and the playback bar moves it
 * through the run.
 */

afterEach(() => {
  cleanup();
});

/** The record's pages of items, as the Steps view asks for them. */
const itemReads = vi.hoisted(() => ({ nodes: [] as string[] }));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useRunItems: (
    _organizationId: string,
    _runId: string | undefined,
    asked: { node: string } | undefined,
  ) => {
    if (asked === undefined) return { data: undefined };
    itemReads.nodes.push(asked.node);
    return { data: { path: asked.node, units: SCORE_UNITS, next: null } };
  },
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a shipped v1 pack, parsed at build time; the engine's corpus test validates it
const TRIAGE = githubTriage as Automation;

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

function step(nodeId: string, startedAt: number): RecordedStep {
  return {
    path: nodeId,
    nodeId,
    type: 'transform',
    status: 'succeeded',
    startedAt,
    endedAt: startedAt + 800,
    activeMs: 800,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
  };
}

/** Every step of the triage chart, one after the other, each 0.8 s. */
const RECORD: RunRecordView = {
  format: 1,
  runId: 'run-1',
  status: 'success',
  version: 1,
  mode: 'mock',
  startedAt: 1_000,
  finishedAt: 1_000 + TRIAGE.nodes.length * 1_000,
  source: 'record',
  nodes: TRIAGE.nodes.map((node, index) =>
    node.id === 'score'
      ? {
          ...step(node.id, 1_000 + index * 1_000),
          counts: { items: 3, ok: 3, failed: 0, skipped: 0, kept: 3 },
        }
      : step(node.id, 1_000 + index * 1_000),
  ),
  events: [],
  eventsTotal: 0,
  cursor: 1_000 + TRIAGE.nodes.length * 1_000,
};

/** Score's three items, a quarter of a second apart, 0.2 s each. */
const SCORE_AT =
  1_000 + TRIAGE.nodes.findIndex((node) => node.id === 'score') * 1_000;
const SCORE_UNITS = [0, 1, 2].map((item) =>
  Object.assign(step('score', SCORE_AT + item * 250), {
    endedAt: SCORE_AT + item * 250 + 200,
    activeMs: 200,
    item,
    pass: -1,
  }),
);

const RUN: CanvasRun = {
  statusByNode: new Map(TRIAGE.nodes.map((node) => [node.id, 'ok'])),
  projection: { byNode: new Map(), effects: [], trace: [] },
  status: 'success',
  record: RECORD,
};

function Harness({
  onSelected,
}: {
  onSelected?: (id: string | null) => void;
} = {}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div style={{ width: 1180, height: 1500 }}>
      <AutomationCanvas
        automation={TRIAGE}
        layoutKey="triage:run-1"
        catalog={CATALOG}
        selectedId={selected}
        onSelect={(id) => {
          setSelected(id);
          onSelected?.(id);
        }}
        inspectorId="inspector"
        run={RUN}
      />
    </div>
  );
}

const node = (id: string) =>
  document.querySelector<HTMLElement>(`[data-flow-node="${CSS.escape(id)}"]`);

describe('AutomationCanvas playing a recorded run in Chromium', () => {
  it('opens on the run’s end and plays the run through again', async () => {
    await page.viewport(1280, 1600);
    const view = render(<Harness />);
    const chart = await waitFor(
      () => {
        const element = view.container.querySelector('[data-flow-engine]');
        if (element === null) throw new Error('no chart yet');
        return element;
      },
      { timeout: 20_000 },
    );
    await waitFor(() => expect(chart).toHaveAttribute('aria-busy', 'false'));
    await viewportAtRest(view.container);

    const last = TRIAGE.nodes.at(-1)?.id ?? '';
    // The whole story first: every step has run.
    for (const each of TRIAGE.nodes) {
      expect(node(each.id), each.id).toHaveAttribute(
        'data-flow-state',
        'succeeded',
      );
    }
    const bar = screen.getByRole('group', { name: 'Run timeline' });
    const previous = within(bar).getByRole('button', {
      name: 'Previous event',
    });
    // Back a few moments, the last step has not finished yet.
    for (let index = 0; index < 3; index++) await userEvent.click(previous);
    await waitFor(() =>
      expect(node(last)).not.toHaveAttribute('data-flow-state', 'succeeded'),
    );

    // Playing goes on from there to the end.
    await userEvent.click(within(bar).getByRole('button', { name: 'Play' }));
    await waitFor(
      () => expect(node(last)).toHaveAttribute('data-flow-state', 'succeeded'),
      { timeout: 15_000 },
    );
  });

  it('lists the same run as its steps in time order, and a row opens its step', async () => {
    await page.viewport(1280, 1600);
    const selected: (string | null)[] = [];
    const view = render(<Harness onSelected={(id) => selected.push(id)} />);
    await waitFor(
      () => {
        if (view.container.querySelector('[data-flow-engine]') === null) {
          throw new Error('no chart yet');
        }
      },
      { timeout: 20_000 },
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Steps' }));
    const steps = await screen.findByRole('tree', { name: 'Steps' });
    // The chart steps aside; the clock and its bar stay.
    expect(view.container.querySelector('[data-flow-engine]')).toBeNull();
    expect(screen.getByRole('group', { name: 'Run timeline' })).toBeVisible();
    const first = TRIAGE.nodes[0]?.id ?? '';
    const row = within(steps)
      .getAllByRole('treeitem')
      .find((item) => (item.textContent ?? '').includes(first));
    expect(row).toBeDefined();
    if (row !== undefined) await userEvent.click(row);
    await waitFor(() => expect(selected).toContain(first));
    // Back to the chart, on the same moment.
    await userEvent.click(screen.getByRole('radio', { name: 'Chart' }));
    await waitFor(() =>
      expect(view.container.querySelector('[data-flow-engine]')).not.toBeNull(),
    );
  });

  it('reads a step’s items when the Steps view opens it, and an item becomes the selection', async () => {
    await page.viewport(1280, 1600);
    itemReads.nodes = [];
    const chosen: { id: string | null; unit?: RunUnitRef }[] = [];
    function ItemsHarness() {
      const [selected, setSelected] = useState<string | null>(null);
      const [unit, setUnit] = useState<RunUnitRef | null>(null);
      return (
        <div style={{ width: 1180, height: 1500 }}>
          <AutomationCanvas
            automation={TRIAGE}
            layoutKey="triage:run-1"
            catalog={CATALOG}
            selectedId={selected}
            selectedUnit={unit}
            onSelect={(id, picked) => {
              setSelected(id);
              setUnit(picked ?? null);
              chosen.push({
                id,
                ...(picked !== undefined && { unit: picked }),
              });
            }}
            inspectorId="inspector"
            run={{ ...RUN, items: { organizationId: 'org-1', runId: 'run-1' } }}
          />
        </div>
      );
    }
    const view = render(<ItemsHarness />);
    await waitFor(
      () => {
        if (view.container.querySelector('[data-flow-engine]') === null) {
          throw new Error('no chart yet');
        }
      },
      { timeout: 20_000 },
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Steps' }));
    await screen.findByRole('tree', { name: 'Steps' });
    const line = (id: string) =>
      document.querySelector<HTMLElement>(
        `[data-flow-timeline-line="${CSS.escape(id)}"]`,
      );
    // Nothing is read before the reader asks.
    expect(line('score')).toHaveAttribute('aria-expanded', 'false');
    expect(itemReads.nodes).toEqual([]);
    const chevron = line('score')?.querySelector(
      '[data-slot="flow-timeline-toggle"]',
    );
    if (!chevron) throw new Error('no chevron on Score');
    await userEvent.click(chevron);
    await waitFor(() => expect(line('score#item:2')).not.toBeNull());
    expect(itemReads.nodes).toContain('score');
    expect(line('score#item:1')).toHaveAccessibleName(
      'Item 2 of 3 (Succeeded, 200ms)',
    );
    await userEvent.click(line('score#item:1') as HTMLElement);
    await waitFor(() =>
      expect(line('score#item:1')).toHaveAttribute('aria-selected', 'true'),
    );
    expect(chosen.at(-1)).toEqual({ id: 'score', unit: { item: 1 } });
    // Back on the chart, the step stays chosen.
    await userEvent.click(screen.getByRole('radio', { name: 'Chart' }));
    await waitFor(() =>
      expect(view.container.querySelector('[data-flow-engine]')).not.toBeNull(),
    );
    expect(chosen.at(-1)?.id).toBe('score');
  });

  it('opens on the view the page holds, and tells the page when the reader switches', async () => {
    await page.viewport(1280, 1600);
    const views: string[] = [];
    function ViewHarness() {
      const [view, setView] = useState<'chart' | 'steps'>('steps');
      return (
        <div style={{ width: 1180, height: 1500 }}>
          <AutomationCanvas
            automation={TRIAGE}
            layoutKey="triage:run-1"
            catalog={CATALOG}
            selectedId={null}
            onSelect={() => undefined}
            inspectorId="inspector"
            run={RUN}
            runView={view}
            onRunViewChange={(next) => {
              views.push(next);
              setView(next);
            }}
          />
        </div>
      );
    }
    render(<ViewHarness />);
    expect(await screen.findByRole('tree', { name: 'Steps' })).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Chart' }));
    expect(views).toEqual(['chart']);
    await waitFor(() =>
      expect(screen.queryByRole('tree', { name: 'Steps' })).toBeNull(),
    );
  });

  it('keeps a step’s items read after a link opened on one of them and the reader moved on', async () => {
    await page.viewport(1280, 1600);
    function LinkedHarness() {
      const [selected, setSelected] = useState<string | null>('score');
      const [unit, setUnit] = useState<RunUnitRef | null>({ item: 1 });
      return (
        <div style={{ width: 1180, height: 1500 }}>
          <AutomationCanvas
            automation={TRIAGE}
            layoutKey="triage:run-1"
            catalog={CATALOG}
            selectedId={selected}
            selectedUnit={unit}
            onSelect={(id, picked) => {
              setSelected(id);
              setUnit(picked ?? null);
            }}
            inspectorId="inspector"
            run={{ ...RUN, items: { organizationId: 'org-1', runId: 'run-1' } }}
            runView="steps"
          />
        </div>
      );
    }
    render(<LinkedHarness />);
    await screen.findByRole('tree', { name: 'Steps' });
    const line = (id: string) =>
      document.querySelector<HTMLElement>(
        `[data-flow-timeline-line="${CSS.escape(id)}"]`,
      );
    await waitFor(() =>
      expect(line('score#item:1')).toHaveAttribute('aria-selected', 'true'),
    );
    const first = TRIAGE.nodes[0]?.id ?? '';
    await userEvent.click(line(first) as HTMLElement);
    await waitFor(() =>
      expect(line(first)).toHaveAttribute('aria-selected', 'true'),
    );
    // Score stays open with its items, never back to "loading".
    expect(line('score#loading')).toBeNull();
    expect(line('score#item:2')).not.toBeNull();
  });
});
