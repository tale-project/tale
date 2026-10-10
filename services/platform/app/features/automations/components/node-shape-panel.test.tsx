import { describe, expect, it, vi } from 'vitest';

import type { NodeDef } from '@/lib/engine/core/types';
import type {
  TypesView,
  WireShape,
} from '@/lib/shared/schemas/automation-issues';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

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
    onSelect = vi.fn(),
  }: {
    status?: ShapeStatus;
    readers?: string[];
    readByOutput?: boolean;
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
      onSelect={onSelect}
      endId="__end"
    />,
  );
}

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

  it('passes an axe audit', async () => {
    const { container } = panel(fetch, typesWith('fetch', issues), {
      readers: ['open_issues'],
    });
    await checkAccessibility(container);
  });
});
