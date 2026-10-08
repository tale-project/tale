import { cleanup } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import { FlowStepList } from './flow-step-list';
import { highlightForNodes } from './paths/highlight';
import { flowStateFromOverlay } from './playback/derive-state';
import {
  branchFlowGraph,
  branchRunOverlay,
  triageFlowGraph,
} from './testing/flow-fixtures';
import type { FlowGraph } from './types';

import '../../globals.css';

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function Harness({
  graph,
  onSelect,
}: {
  graph: FlowGraph;
  onSelect?: (id: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <FlowStepList
      graph={graph}
      aria-label="Nodes of Triage"
      selectedId={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect?.(id);
      }}
      issues={new Map([['report', { errors: 1, warnings: 0 }]])}
    />
  );
}

describe('FlowStepList', () => {
  it('lists Start, every node in order and End, frames indented', () => {
    render(<Harness graph={triageFlowGraph()} />);
    const list = screen.getByRole('list', { name: 'Nodes of Triage' });
    const names = within(list)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      'Start',
      'Issues',
      'Open issues',
      'Score',
      'Report (1 error)',
      'End',
    ]);
    // Score sits in a nested list under its frame's words.
    const score = screen.getByRole('button', { name: 'Score' });
    expect(score.closest('ol')).not.toBe(list);
    expect(
      score.closest('li')?.parentElement?.closest('li')?.textContent,
    ).toContain('For each item of issues of Open issues');
    expect(score).toHaveAccessibleDescription(
      /Reads Open issues and each item/,
    );
  });

  it('folds a condition into the node it guards', () => {
    render(<Harness graph={branchFlowGraph()} />);
    expect(screen.queryByRole('button', { name: /^Condition for/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Urgent' }),
    ).toHaveAccessibleDescription(/Runs only if urgent of Classify is true/);
    expect(
      screen.getByRole('button', { name: 'Low' }),
    ).toHaveAccessibleDescription(/Runs when the condition of Normal is false/);
  });

  it('is one Tab stop: arrows move, Home and End jump, Enter opens', async () => {
    const onSelect = vi.fn();
    render(<Harness graph={triageFlowGraph()} onSelect={onSelect} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Start' }),
    );
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open issues' }),
    );
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'End' }),
    );
    await userEvent.keyboard('{Home}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('issues');
    expect(screen.getByRole('button', { name: 'Issues' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it.each(['light', 'dark'])('passes axe (%s)', async (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const { container } = render(<Harness graph={branchFlowGraph()} />);
    const result = await axe.run(container, {
      runOnly: [
        'color-contrast',
        'list',
        'listitem',
        'button-name',
        'aria-allowed-attr',
        'aria-valid-attr-value',
      ],
    });
    expect(result.violations).toEqual([]);
  });

  it('is named "Nodes" unless the host names it', () => {
    render(<FlowStepList graph={triageFlowGraph()} />);
    expect(screen.getByRole('list', { name: 'Nodes' })).toBeInTheDocument();
  });

  it('says how each node went in a run, and why a row steps back', () => {
    const graph = branchFlowGraph();
    render(
      <FlowStepList
        graph={graph}
        aria-label="Nodes"
        run={flowStateFromOverlay(graph, branchRunOverlay())}
        highlight={{
          ...highlightForNodes(graph, ['fetch', 'merge']),
          reasons: { notify: 'Not on this path' },
        }}
      />,
    );
    const fetch = screen.getByRole('button', { name: 'Fetch (Succeeded)' });
    expect(fetch).toHaveAccessibleDescription(/^Succeeded · 390 ms/);
    expect(within(fetch).getByRole('img', { name: 'Succeeded' })).toBeVisible();
    const notify = screen.getByRole('button', { name: 'Notify (Failed)' });
    expect(notify).toHaveAttribute('data-flow-quiet', 'true');
    expect(notify).toHaveAccessibleDescription(
      /^The mail server refused the message Not on this path Reads Merge/,
    );
    expect(
      screen.getByRole('button', { name: 'Fetch (Succeeded)' }),
    ).not.toHaveAttribute('data-flow-quiet');
  });

  it('says so when there is nothing to list', () => {
    render(
      <FlowStepList graph={{ nodes: [], edges: [] }} aria-label="Nodes" />,
    );
    expect(screen.getByText('No nodes yet')).toBeInTheDocument();
  });
});
