import '@testing-library/jest-dom/vitest';
import { viewportAtRest } from '@tale/ui/testing/flow';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
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
    step(node.id, 1_000 + index * 1_000),
  ),
  events: [],
  eventsTotal: 0,
  cursor: 1_000 + TRIAGE.nodes.length * 1_000,
};

const RUN: CanvasRun = {
  statusByNode: new Map(TRIAGE.nodes.map((node) => [node.id, 'ok'])),
  projection: { byNode: new Map(), effects: [], trace: [] },
  status: 'success',
  record: RECORD,
};

function Harness() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div style={{ width: 1180, height: 1500 }}>
      <AutomationCanvas
        automation={TRIAGE}
        layoutKey="triage:run-1"
        catalog={CATALOG}
        selectedId={selected}
        onSelect={setSelected}
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
});
