import { describe, expect, it, vi } from 'vitest';

import type { NodeDef } from '@/lib/engine/core/types';
import type {
  TypesView,
  WireShape,
} from '@/lib/shared/schemas/automation-issues';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { ConnectorScenarioSummary } from './connector-scenario';
import { NodeShapePanel, type ShapeStatus } from './node-shape-panel';

const issues: WireShape = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object' } },
    total: { type: 'number' },
  },
  required: ['issues'],
};

function typesWith(node: string, output: WireShape, extra = {}): TypesView {
  return {
    inputs: {},
    nodes: { [node]: { output, ...extra } },
    output: {},
  };
}

function panel(
  node: NodeDef,
  types: TypesView | null,
  {
    status = 'ready',
    readers = [],
    readByOutput = false,
    scenarios,
    onSelect = vi.fn(),
  }: {
    status?: ShapeStatus;
    readers?: string[];
    readByOutput?: boolean;
    scenarios?: readonly ConnectorScenarioSummary[];
    onSelect?: (id: string) => void;
  } = {},
) {
  return render(
    <NodeShapePanel
      node={node}
      types={types}
      status={status}
      words={{ connector: 'GitHub', type: 'Language model' }}
      readers={readers}
      readByOutput={readByOutput}
      {...(scenarios !== undefined && { scenarios })}
      onSelect={onSelect}
      endId="__end"
    />,
  );
}

/** Two of the scenarios Slack's channel lookup ships, and one of a kind
 * this editor does not know yet. */
const scenarios: ConnectorScenarioSummary[] = [
  {
    name: 'one_channel',
    kind: 'success',
    description: 'Slack returns the channel.',
  },
  {
    name: 'channel_not_found',
    kind: 'error',
    description: 'Slack answers that no channel has this id.',
    when: { channel: 'C0000000009' },
  },
  {
    name: 'slow_reply',
    kind: 'throttled',
    description: 'Slack answers late.',
  },
];

describe('NodeShapePanel', () => {
  const fetch = { id: 'fetch', type: 'github.list_issues' };

  it('shows what a node returns, with where the shape comes from', () => {
    panel(fetch, typesWith('fetch', { ...issues, 'x-origin': 'signature' }));
    const returns = screen.getByRole('region', { name: 'Returns' });
    expect(within(returns).getByText('As GitHub describes it')).toBeVisible();
    expect(within(returns).getByText('issues')).toBeVisible();
    expect(within(returns).getByText('total')).toBeVisible();
    expect(within(returns).getByText('Show as TypeScript')).toBeVisible();
  });

  it.each([
    ['declared', 'From its output schema'],
    ['inferred', 'Worked out from its code'],
    ['fixed', 'Every node of this type (Language model) returns this'],
  ] as const)('names the %s origin', (origin, words) => {
    panel(fetch, typesWith('fetch', { ...issues, 'x-origin': origin }));
    expect(screen.getByText(words)).toBeVisible();
  });

  it('names the automation a subautomation returns from', () => {
    panel(
      { id: 'child', type: 'subautomation', automation: 'support/triage_mail' },
      typesWith('child', { ...issues, 'x-origin': 'child' }),
    );
    expect(screen.getByText('What Triage mail returns')).toBeVisible();
  });

  it('says when nothing tells what a node returns', () => {
    panel(fetch, typesWith('fetch', {}));
    expect(
      screen.getByText(
        "Tale can't tell what this returns. A test run shows the real data.",
      ),
    ).toBeVisible();
  });

  it('shows what transform code reads as input, and each item under For each', () => {
    panel(
      { id: 'score', type: 'transform', forEach: '{{ nodes.fetch.output }}' },
      typesWith('score', issues, {
        input: { type: 'object', properties: { text: { type: 'string' } } },
        item: { type: 'object', properties: { title: { type: 'string' } } },
      }),
    );
    expect(
      screen.getByRole('region', { name: 'What its code reads as input' }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Each item' })).toBeVisible();
  });

  it('selects a reader, or End for the output', async () => {
    const onSelect = vi.fn();
    const { user } = panel(fetch, typesWith('fetch', issues), {
      readers: ['open_issues'],
      readByOutput: true,
      onSelect,
    });
    await user.click(screen.getByRole('button', { name: 'Open issues' }));
    expect(onSelect).toHaveBeenLastCalledWith('open_issues');
    await user.click(
      screen.getByRole('button', { name: 'The automation output' }),
    );
    expect(onSelect).toHaveBeenLastCalledWith('__end');
  });

  it('says when nothing reads the output', () => {
    panel(fetch, typesWith('fetch', issues));
    expect(screen.getByText('Nothing reads its output.')).toBeVisible();
  });

  it('keeps the last shapes while a check runs, and says so', () => {
    const { container } = panel(fetch, typesWith('fetch', issues), {
      status: 'checking',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Updating…');
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('issues')).toBeVisible();
  });

  it('says the shapes could not be worked out when the check failed', () => {
    panel(fetch, null, { status: 'failed' });
    expect(
      screen.getByText(
        "Couldn't work out the shapes. They appear after the next successful check.",
      ),
    ).toBeVisible();
  });

  it('lists the scenarios the action ships: each kind, what it is, and which calls it answers', () => {
    panel(
      { id: 'lookup', type: 'slack.get_channel' },
      typesWith('lookup', issues),
      { scenarios },
    );
    const section = screen.getByRole('region', { name: 'Scenarios' });
    expect(section).toHaveTextContent(
      'A test can pick one of these for this node in its Setup, or several that its calls take in order. The node then answers as described instead of calling.',
    );
    const [found, notFound, slow] = within(section).getAllByRole('listitem');
    expect(found).toHaveTextContent('one_channel');
    expect(found).toHaveTextContent('Success');
    expect(found).toHaveTextContent('Slack returns the channel.');
    expect(found).not.toHaveTextContent('Only for calls');
    expect(notFound).toHaveTextContent('channel_not_found');
    expect(notFound).toHaveTextContent('Error');
    expect(notFound).toHaveTextContent(
      'Only for calls whose input has channel: "C0000000009". Any other call gets the usual simulated answer.',
    );
    // A kind a newer server sends shows as written.
    expect(slow).toHaveTextContent('throttled');
  });

  it('shows no scenarios for an action that ships none', () => {
    panel(fetch, typesWith('fetch', issues));
    expect(
      screen.queryByRole('region', { name: 'Scenarios' }),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = panel(fetch, typesWith('fetch', issues), {
      readers: ['open_issues'],
      scenarios,
    });
    expect(screen.getByRole('region', { name: 'Scenarios' })).toBeVisible();
    await checkAccessibility(container);
  });
});
