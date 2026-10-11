import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { diffAutomationDocuments } from '@/lib/engine/core/diff/automation';
import type { Automation } from '@/lib/engine/core/types';
import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { mergeNodeTypes } from '../../hooks/backend';
import { nodeCatalogView } from '../../lib/node-face';
import { VersionGraph } from './version-graph';

import '@/app/globals.css';

/**
 * Two versions of an automation on one chart, laid out and drawn by the real
 * canvas: what each box became, and the lines only one version draws.
 */

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('tale:flow-view');
});

const CATALOG = nodeCatalogView(mergeNodeTypes([]));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a hand-written document of the engine's grammar
const BEFORE = {
  version: 1,
  name: 'digest',
  nodes: [
    { id: 'collect', type: 'transform', code: "return 'a';" },
    {
      id: 'answer',
      type: 'transform',
      when: '{{ nodes.collect.output }}',
      code: 'return nodes.collect.output;',
    },
    { id: 'notify', type: 'transform', code: "return 'n';" },
  ],
  output: '{{ nodes.answer.output }}',
} as Automation;

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above
const AFTER = {
  version: 1,
  name: 'digest',
  nodes: [
    { id: 'collect', type: 'transform', code: "return 'b';" },
    {
      id: 'reply',
      type: 'transform',
      when: '{{ nodes.collect.output }}',
      code: 'return nodes.collect.output;',
    },
    { id: 'archive', type: 'transform', code: "return 'x';" },
  ],
  output: '{{ nodes.reply.output }}',
} as Automation;

const DIFF = diffAutomationDocuments(BEFORE, AFTER);
const LABELS = { before: 'v4', after: 'v5' };

function renderGraph(onSelect = vi.fn()) {
  render(
    <div style={{ height: 760 }}>
      <VersionGraph
        automationSlug="digest"
        before={BEFORE}
        after={AFTER}
        diff={DIFF}
        labels={LABELS}
        catalog={CATALOG}
        selectedId={null}
        onSelect={onSelect}
      />
    </div>,
  );
  return onSelect;
}

const markOf = (name: RegExp) =>
  screen.getByRole('button', { name }).getAttribute('data-flow-diff');

describe('the graph of a comparison in Chromium', () => {
  it('marks every box with what it became, and picks one', async () => {
    await page.viewport(1280, 900);
    const onSelect = renderGraph();
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /^Notify/ })).toBeVisible(),
      { timeout: 15_000 },
    );
    expect(markOf(/^Archive/)).toBe('added');
    expect(markOf(/^Notify/)).toBe('removed');
    expect(markOf(/^Collect/)).toBe('changed');
    expect(markOf(/^Reply/)).toBe('renamed');
    // The changed box says what changed, the renamed one its old name.
    expect(screen.getByRole('button', { name: /^Collect/ })).toHaveTextContent(
      'Code changed',
    );
    expect(screen.getByRole('button', { name: /^Reply/ })).toHaveTextContent(
      'Was Answer',
    );
    // Its condition moved with it: one box, unmarked — never a removed and
    // an added one.
    expect(
      document.querySelector('[data-flow-node="__gate:answer"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-flow-node="__gate:reply"]'),
    ).not.toHaveAttribute('data-flow-diff');
    await userEvent.click(screen.getByRole('button', { name: /^Collect/ }));
    expect(onSelect).toHaveBeenCalledWith('collect');
  });

  it("shows either version's own chart with what changed brought forward", async () => {
    await page.viewport(1280, 900);
    renderGraph();
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /^Notify/ })).toBeVisible(),
      { timeout: 15_000 },
    );
    await userEvent.click(screen.getByRole('radio', { name: 'v5' }));
    // v5's own chart is laid out afresh: Notify is gone, Archive stays.
    await waitFor(
      () => {
        expect(screen.queryByRole('button', { name: /^Notify/ })).toBeNull();
        expect(screen.getByRole('button', { name: /^Archive/ })).toBeVisible();
      },
      { timeout: 15_000 },
    );
  });
});
