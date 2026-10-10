import { describe, expect, it, vi } from 'vitest';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { Automation } from '@/lib/engine/core/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen, within } from '@/tests/utils/render';

import { coreNodeTypes } from '../hooks/backend';
import { toIssueView, withIssueIds } from '../lib/issues';
import { nodeCatalogView } from '../lib/node-face';
import { EndInspector } from './end-inspector';
import type { InspectorContext } from './node-inspector';
import { StartInspector } from './start-inspector';

vi.mock('@tanstack/react-router', async () => {
  const { forwardRef } = await import('react');
  return {
    Link: forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement> & { to?: string }
    >(function Link({ to, children, ...rest }, ref) {
      return (
        <a ref={ref} href={to ?? '#'} {...rest}>
          {children}
        </a>
      );
    }),
  };
});

const DOC: Automation = {
  name: 'support/triage',
  nodes: [
    { id: 'fetch_issues', type: 'transform', code: 'return [];' },
    {
      id: 'notify',
      type: 'transform',
      code: 'return 1;',
      onError: 'continue',
      input: { list: '{{ nodes.fetch_issues.output }}' },
    },
  ],
  output: '{{ nodes.notify.output }}',
};

function contextFor(doc: Automation): InspectorContext {
  return {
    doc,
    flow: analyzeFlow(doc.nodes),
    analysis: {
      nodes: {},
      paths: {
        count: 1,
        truncated: false,
        halts: [{ nodeId: 'fetch_issues', reasons: ['code'] }],
      },
      output: { reads: ['notify'], maybeEmpty: true },
    },
    types: {
      inputs: { type: 'object', properties: { owner: { type: 'string' } } },
      nodes: {},
      output: { type: 'number' },
    },
    shapeStatus: 'ready',
    diagnosticsStatus: 'ready',
    settled: null,
    catalog: nodeCatalogView(coreNodeTypes()),
  };
}

const t = i18n.getFixedT('en', 'automations');

describe('StartInspector', () => {
  it('says any input is taken when the document declares none', () => {
    render(
      <StartInspector
        id="start"
        triggers={[]}
        readOnly={false}
        onChange={vi.fn()}
        context={contextFor(DOC)}
      />,
    );
    expect(screen.getByText('Any JSON input')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Input schema' })).toHaveValue(
      '',
    );
  });

  it('shows a refused trigger under the input schema, and passes axe', async () => {
    const doc: Automation = {
      ...DOC,
      inputs: { type: 'object', required: ['owner'] },
    };
    const issues = withIssueIds([
      {
        level: 'error',
        code: 'TRIGGER_INPUT_MISMATCH',
        message: 'the schedule starts runs without owner',
        at: { pointer: '' },
      },
    ]).map((issue) =>
      toIssueView(issue, doc, {
        locale: 'en',
        t,
        controlsOf: () => new Set(),
      }),
    );
    const { container } = render(
      <StartInspector
        id="start"
        triggers={[]}
        readOnly={false}
        onChange={vi.fn()}
        issues={issues}
        context={contextFor(doc)}
      />,
    );
    expect(
      screen.getByRole('textbox', { name: 'Input schema' }),
    ).toHaveAttribute('aria-invalid', 'true');
    await checkAccessibility(container);
  });

  it('shows the shape every run receives', async () => {
    const { user } = render(
      <StartInspector
        id="start"
        triggers={[]}
        readOnly
        onChange={vi.fn()}
        context={contextFor(DOC)}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'Shape' }));
    expect(
      within(screen.getByRole('tabpanel', { name: 'Shape' })).getByRole(
        'heading',
        {
          name: 'Receives',
        },
      ),
    ).toBeVisible();
  });
});

describe('EndInspector', () => {
  it('lists the nodes whose failure stops the run, with why, and picks one', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <EndInspector
        id="end"
        readOnly={false}
        onChange={vi.fn()}
        context={{ ...contextFor(DOC), onSelect }}
      />,
    );
    const ends = screen.getByRole('list', { name: 'How a run ends' });
    expect(within(ends).getByText(/when 1 node fails/)).toBeVisible();
    // Notify goes on without itself; only Fetch issues stops the run.
    await user.click(
      screen.getByRole('button', {
        name: 'Fetch issues fails when its code throws an error',
      }),
    );
    expect(onSelect).toHaveBeenCalledWith('fetch_issues');
  });

  it('commits an output of any kind and clears it when blank', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <EndInspector
        id="end"
        readOnly={false}
        onChange={onChange}
        context={contextFor(DOC)}
      />,
    );
    const output = screen.getByRole('textbox', { name: 'Output' });
    expect(output).toHaveAttribute('data-templates', '');
    await user.clear(output);
    expect(onChange).toHaveBeenLastCalledWith({ output: undefined });
    await user.type(output, '42');
    expect(onChange).toHaveBeenLastCalledWith({ output: 42 });
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <EndInspector
        id="end"
        readOnly={false}
        onChange={vi.fn()}
        context={contextFor(DOC)}
      />,
    );
    await checkAccessibility(container);
  });
});
