// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { diffAutomationDocuments } from '@/lib/engine/core/diff/automation';
import type { Automation } from '@/lib/engine/core/types';
import { render, screen, within } from '@/tests/utils/render';

import { nodeCatalogView } from '../../lib/node-face';
import {
  graphBoxOf,
  itemsOfBox,
  useVersionChangeSections,
  VersionChanges,
} from './version-changes';

const BEFORE = {
  version: 1,
  name: 'digest',
  nodes: [
    { id: 'collect', type: 'transform', code: "return 'collect';" },
    { id: 'post', type: 'transform', code: "return 'post';" },
  ],
  output: '{{ nodes.post.output }}',
  tests: [{ name: 'says hello', input: {}, expect: { output: 'hello' } }],
} as unknown as Automation;

const AFTER = {
  version: 1,
  name: 'digest',
  inputs: {
    type: 'object',
    properties: { week: { type: 'string' } },
    required: ['week'],
  },
  nodes: [
    { id: 'collect', type: 'transform', code: 'return input.week;' },
    { id: 'publish', type: 'transform', code: "return 'post';" },
  ],
  output: '{{ nodes.publish.output }}',
  tests: [
    { name: 'says hello', input: { week: 'W41' }, expect: { output: 'hello' } },
  ],
} as unknown as Automation;

const LABELS = { before: 'v6', after: 'v7' };
const CATALOG = nodeCatalogView([]);

function Changes({ onShowOnGraph }: { onShowOnGraph?: (id: string) => void }) {
  const sections = useVersionChangeSections({
    diff: diffAutomationDocuments(BEFORE, AFTER),
    before: BEFORE,
    after: AFTER,
    labels: LABELS,
    catalog: CATALOG,
  });
  return (
    <VersionChanges
      sections={sections}
      {...(onShowOnGraph !== undefined && { onShowOnGraph })}
    />
  );
}

describe('the changes of a comparison', () => {
  it('groups what changed by where it is, each with its badge and words', () => {
    render(<Changes />);
    const start = screen.getByRole('region', { name: /^Start: run inputs/ });
    expect(within(start).getByText('week')).toBeVisible();
    expect(within(start).getByText('Now required')).toBeVisible();
    const nodes = screen.getByRole('region', { name: /^Nodes/ });
    expect(within(nodes).getByText('Collect')).toBeVisible();
    expect(within(nodes).getByText('Code changed')).toBeVisible();
    expect(within(nodes).getByText('Publish')).toBeVisible();
    expect(within(nodes).getByText('Was Post')).toBeVisible();
    expect(
      screen.getByRole('region', { name: /^End: output/ }),
    ).toHaveTextContent('Output');
    const tests = screen.getByRole('region', { name: /^Tests/ });
    expect(within(tests).getByText('says hello')).toBeVisible();
    expect(within(tests).getByText('Input changed')).toBeVisible();
    expect(
      screen.getByText(
        'Triggers and projects belong to the automation, not to a version.',
      ),
    ).toBeVisible();
  });

  it('shows a node, an input or the output on the graph, but never a test', async () => {
    const onShowOnGraph = vi.fn();
    const { user } = render(<Changes onShowOnGraph={onShowOnGraph} />);
    const nodes = screen.getByRole('region', { name: /^Nodes/ });
    await user.click(within(nodes).getByRole('button', { name: /Collect/ }));
    await user.click(
      within(nodes).getByRole('button', { name: 'Show on the graph' }),
    );
    expect(onShowOnGraph).toHaveBeenLastCalledWith('collect');
    const start = screen.getByRole('region', { name: /^Start: run inputs/ });
    await user.click(within(start).getByRole('button', { name: /week/ }));
    await user.click(
      within(start).getAllByRole('button', { name: 'Show on the graph' })[0]!,
    );
    expect(onShowOnGraph).toHaveBeenLastCalledWith('__start');
    await user.click(screen.getByRole('button', { name: /says hello/ }));
    expect(
      within(screen.getByRole('region', { name: /^Tests/ })).queryByRole(
        'button',
        { name: 'Show on the graph' },
      ),
    ).toBeNull();
  });
});

describe('graph boxes and the list', () => {
  it('maps each item to the box it is shown on', () => {
    expect(graphBoxOf('node:collect')).toBe('collect');
    expect(graphBoxOf('input:week')).toBe('__start');
    expect(graphBoxOf('end:output')).toBe('__end');
    expect(graphBoxOf('test:says hello')).toBeNull();
    expect(graphBoxOf('package:settings')).toBeNull();
    const sections = [
      {
        id: 'start',
        title: 'Start',
        items: [
          { id: 'input:week', kind: 'added' as const, title: 'week' },
          { id: 'input:', kind: 'added' as const, title: 'schema' },
        ],
      },
      {
        id: 'nodes',
        title: 'Nodes',
        items: [{ id: 'node:a', kind: 'changed' as const, title: 'A' }],
      },
    ];
    expect(itemsOfBox(sections, '__start').map((item) => item.id)).toEqual([
      'input:week',
      'input:',
    ]);
    expect(itemsOfBox(sections, 'a').map((item) => item.id)).toEqual([
      'node:a',
    ]);
    expect(itemsOfBox(sections, 'b')).toEqual([]);
  });
});
