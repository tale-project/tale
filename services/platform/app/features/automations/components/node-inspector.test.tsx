import { IssueFocusProvider, useRequestIssueFocus } from '@tale/ui/issue-focus';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { analyzeFlow } from '@/lib/engine/core/analysis/flow';
import type { NodeDef } from '@/lib/engine/core/types';
import type { WireAutomationIssue } from '@/lib/shared/schemas/automation-issues';
import { checkAccessibility } from '@/tests/utils/a11y';
import { i18n } from '@/tests/utils/i18n-all-languages';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { coreNodeTypes } from '../hooks/backend';
import { fieldsWithIssueControl } from '../lib/inspector-fields';
import {
  toIssueView,
  withIssueIds,
  type AutomationIssueView,
} from '../lib/issues';
import { nodeCatalogView } from '../lib/node-face';
import { NodeInspector, type InspectorContext } from './node-inspector';

/**
 * The inspector shows the fields the ENGINE REGISTRY declares for a node type —
 * never a list written out here — so these tests drive it with the registry's
 * own entries. A type the catalog does not know still shows the node's input
 * and control flow rather than an empty panel.
 *
 * Controls are queried by ACCESSIBLE NAME rather than by label text: a required
 * field's `<label>` carries an `aria-hidden` asterisk, so its text content is
 * "Prompt*" while the name a screen reader announces is "Prompt" — and the
 * announced name is what these tests are actually about.
 */
vi.mock('@tale/ui/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json">{JSON.stringify(data)}</pre>
  ),
}));

// The llm node's Model picker reads the organization's served models off the
// composer roster; this test org serves exactly one direct model and one
// subscription-only entry (offered to agents, never to an llm node).
const roster = vi.hoisted(() => ({
  data: {
    harnesses: [],
    models: [
      {
        id: 'anthropic/claude-haiku-4-5',
        label: 'anthropic/claude-haiku-4-5',
        providerSlug: 'openrouter',
        providerLabel: 'OpenRouter',
        credential: { authMethod: 'api-key' },
      },
      {
        id: 'claude-fable-5',
        label: 'claude-fable-5',
        providerSlug: 'anthropic',
        providerLabel: 'Anthropic',
        credential: {
          authMethod: 'subscription-broker',
          constraints: { harness: 'claude-code' },
        },
      },
    ],
  } as unknown,
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectHarnesses: () => ({ data: roster.data }),
}));

const llmType = coreNodeTypes().find((def) => def.type === 'llm');

/** A document around the node under test, with no check behind it. */
const baseContext: InspectorContext = {
  doc: { version: 1, name: 'support/reply', nodes: [] },
  flow: null,
  analysis: null,
  types: null,
  shapeStatus: 'off',
  diagnosticsStatus: 'ready',
  settled: null,
  catalog: nodeCatalogView(coreNodeTypes()),
};
const transformType = coreNodeTypes().find((def) => def.type === 'transform');

const llmNode = {
  id: 'summary',
  type: 'llm',
  model: 'anthropic/claude-haiku-4-5',
  prompt: 'One sentence, please.',
  when: '{{ nodes.calc.output.count > 0 }}',
};

describe('NodeInspector', () => {
  it('fills the workbench column in either frame', () => {
    const { container, rerender } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    const section = container.querySelector('section#inspector');
    // A run's page: a card in the page inset.
    expect(section).toHaveClass('h-full', 'rounded-lg', 'border');
    rerender(
      <NodeInspector
        id="inspector"
        variant="panel"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    // The Editor tab's edge-to-edge workbench: flush against the canvas,
    // bordered only where it meets it.
    expect(section).toHaveClass('h-full', 'border-t', 'lg:border-l');
    expect(section).not.toHaveClass('rounded-lg');
  });

  it('renders exactly the fields the registry declares for the type', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveValue(
      'One sentence, please.',
    );
    // The model is a picker over the models the organization serves, and
    // the saved (served) model reads on its trigger.
    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent(
      'anthropic/claude-haiku-4-5',
    );
    expect(screen.queryByRole('textbox', { name: 'Model id' })).toBeNull();
    // `code` belongs to `transform`, not to `llm`.
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull();
  });

  /**
   * The Model field of an llm node used to be a bare text box that accepted
   * any id, so a model nobody served was discovered on the first live run
   * (2026-09-26 evaluation, D-16). It is now the served-model picker with a
   * typed escape that says a live run would fail.
   */
  describe('llm model picker', () => {
    it('offers only direct-served models and stores the pick as `model` alone', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <NodeInspector
          id="inspector"
          node={llmNode}
          nodeType={llmType}
          readOnly={false}
          organizationId="org_test"
          context={baseContext}
          onChange={onChange}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Model' }));
      expect(
        screen.getByRole('option', { name: /anthropic\/claude-haiku-4-5/ }),
      ).toBeVisible();
      expect(
        screen.queryByRole('option', { name: /^claude-fable-5/ }),
      ).toBeNull();
      await user.click(
        screen.getByRole('option', { name: /anthropic\/claude-haiku-4-5/ }),
      );
      expect(onChange).toHaveBeenCalledWith({
        model: 'anthropic/claude-haiku-4-5',
      });
    });

    it('keeps an unlisted model editable and says a live run would fail', () => {
      render(
        <NodeInspector
          id="inspector"
          node={{ ...llmNode, model: 'nonexistent/model-xyz' }}
          nodeType={llmType}
          readOnly={false}
          organizationId="org_test"
          context={baseContext}
          onChange={vi.fn()}
        />,
      );
      expect(screen.getByRole('textbox', { name: 'Model id' })).toHaveValue(
        'nonexistent/model-xyz',
      );
      expect(
        screen.getByText(
          /No connected provider serves "nonexistent\/model-xyz"/,
        ),
      ).toBeVisible();
    });

    it('opens the typed escape on request', async () => {
      const onChange = vi.fn();
      const { user } = render(
        <NodeInspector
          id="inspector"
          node={llmNode}
          nodeType={llmType}
          readOnly={false}
          organizationId="org_test"
          context={baseContext}
          onChange={onChange}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Type a model that is not listed' }),
      );
      const box = screen.getByRole('textbox', { name: 'Model id' });
      expect(box).toHaveValue('anthropic/claude-haiku-4-5');
      await user.type(box, 'x');
      expect(onChange).toHaveBeenLastCalledWith({
        model: 'anthropic/claude-haiku-4-5x',
      });
    });
  });

  it('renders the transform body for a transform node', () => {
    render(
      <NodeInspector
        id="inspector"
        node={{ id: 'calc', type: 'transform', code: 'return 1;' }}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue(
      'return 1;',
    );
  });

  it('patches the node as the author types', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={{ id: 'calc', type: 'transform', code: '' }}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={onChange}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Code' }), 'x');
    expect(onChange).toHaveBeenCalledWith({ code: 'x' });
  });

  it('refuses to patch the node from JSON that does not parse yet', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={{ id: 'calc', type: 'transform', code: '' }}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={onChange}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Input' }), '{{');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/not valid json yet/i)).toBeVisible();
  });

  it('leads with the node fields, not the empty input JSON', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    const input = screen.getByRole('textbox', { name: 'Input' });
    expect(
      prompt.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('does not dump the type catalog into the header', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/Call a language model with a templated prompt/),
    ).toBeNull();
  });

  it('shows the control-flow fields every node type accepts', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue(
      '{{ nodes.calc.output.count > 0 }}',
    );
    expect(screen.getByRole('textbox', { name: 'For each' })).toHaveValue('');
  });

  it('opens on the control flow a node has, without repeating it as badges', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Control flow').closest('details')).toHaveAttribute(
      'open',
    );
    expect(screen.getByRole('textbox', { name: 'When' })).toBeVisible();
    // The canvas box badges the condition; here the open field is enough.
    expect(screen.queryByText(/^when \{\{/)).toBeNull();
  });

  it('keeps unused control flow behind a disclosure', async () => {
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={{ id: 'calc', type: 'transform', code: 'return 1;' }}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Control flow').closest('details'),
    ).not.toHaveAttribute('open');
    await user.click(screen.getByText('Control flow'));
    expect(screen.getByText('Control flow').closest('details')).toHaveAttribute(
      'open',
    );
    expect(screen.getByRole('textbox', { name: 'When' })).toBeVisible();
  });

  it('keeps an empty output schema behind a disclosure', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen
        .getByText('Output schema', { selector: 'summary' })
        .closest('details'),
    ).not.toHaveAttribute('open');
  });

  it('still shows the node when the catalog does not know its type', () => {
    render(
      <NodeInspector
        id="inspector"
        node={{ id: 'ping', type: 'acme.ping' }}
        nodeType={undefined}
        catalogUnavailable
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Unknown node type: acme.ping')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Input' })).toBeVisible();
    expect(
      screen.getByText(/couldn't load the node-type catalog/i),
    ).toBeVisible();
  });

  it('shows what the overlaid run did to this node, effects included', async () => {
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        runView={{
          status: 'ok',
          input: { prompt: 'hi' },
          output: { text: 'done' },
          effects: [
            {
              node: 'summary',
              connector: 'slack.post_message',
              input: { text: 'done' },
            },
          ],
        }}
        readOnly
        onChange={vi.fn()}
        organizationId="org_test"
        context={baseContext}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
      'readonly',
    );
    // What the run did is its own tab, there only while a run is shown.
    await user.click(screen.getByRole('tab', { name: 'Last run' }));
    expect(screen.getByText('slack.post_message')).toBeVisible();
  });

  it('closes from the header control', async () => {
    const onDeselect = vi.fn();
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
        onDeselect={onDeselect}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape when a node is selected', async () => {
    const onDeselect = vi.fn();
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
        onDeselect={onDeselect}
      />,
    );
    await user.keyboard('{Escape}');
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape while a field is focused', async () => {
    const onDeselect = vi.fn();
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
        onDeselect={onDeselect}
      />,
    );
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }));
    await user.keyboard('{Escape}');
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('moves focus into the inspector when a node is selected', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
        onDeselect={vi.fn()}
      />,
    );
    expect(document.getElementById('inspector')).toHaveFocus();
  });

  it('scrolls to the top when the selected node changes', () => {
    const { rerender } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    const section = document.getElementById('inspector');
    expect(section).not.toBeNull();
    if (section === null) return;
    section.scrollTop = 120;
    rerender(
      <NodeInspector
        id="inspector"
        node={{ ...llmNode, id: 'other' }}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
      />,
    );
    expect(section.scrollTop).toBe(0);
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={vi.fn()}
        onDeselect={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });
});

describe('NodeInspector problems', () => {
  const doc = { version: 1, name: 'support/reply', nodes: [llmNode] };
  const t = i18n.getFixedT('en', 'automations');
  const controlsOf = (node: NodeDef) =>
    fieldsWithIssueControl(node, llmType?.allowedFields ?? []);

  function views(issues: WireAutomationIssue[]): AutomationIssueView[] {
    return withIssueIds(issues).map((issue) =>
      toIssueView(issue, doc, { locale: 'en', t, controlsOf }),
    );
  }

  const promptError: WireAutomationIssue = {
    level: 'error',
    code: 'REF_UNKNOWN_NODE',
    message: 'nodes.nope does not exist',
    at: { pointer: '/nodes/0/prompt', range: [4, 12] },
    params: {
      node: 'summary',
      field: 'prompt',
      ref: 'nope',
      available: ['calc'],
    },
  };

  /** Asks the page's focus registry to go to a problem, like the list does. */
  function GoTo({
    anchor,
    range,
  }: {
    anchor: string;
    range?: readonly [number, number];
  }) {
    const request = useRequestIssueFocus();
    return (
      <button type="button" onClick={() => request(anchor, range)}>
        go to
      </button>
    );
  }

  function inspector(
    issues: AutomationIssueView[],
    extra?: ReactNode,
    node: NodeDef = llmNode,
  ) {
    return render(
      <IssueFocusProvider>
        {extra}
        <NodeInspector
          id="inspector"
          node={node}
          nodeType={llmType}
          readOnly={false}
          organizationId="org_test"
          context={baseContext}
          onChange={vi.fn()}
          issues={issues}
          nodeIndex={0}
        />
      </IssueFocusProvider>,
    );
  }

  it("shows a field's problem under its control as a description, never as an alert", () => {
    const [view] = views([promptError]);
    inspector(view === undefined ? [] : [view]);
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    const cause = view?.item.cause;
    expect(prompt).toHaveAccessibleDescription(
      expect.stringContaining(typeof cause === 'string' ? cause : 'no cause'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('describes a field with a warning without marking it invalid', () => {
    inspector(views([{ ...promptError, level: 'warning' }]));
    const prompt = screen.getByRole('textbox', { name: 'Prompt' });
    expect(prompt).not.toHaveAttribute('aria-invalid', 'true');
    expect(prompt).toHaveAccessibleDescription(/Warning:/);
  });

  it('lists the problems without a box of their own at the top', () => {
    inspector(
      views([
        {
          level: 'warning',
          code: 'LLM_MODEL_UNAVAILABLE',
          message: 'no provider serves the model',
          at: { pointer: '/nodes/0/model' },
          params: { node: 'summary', model: 'anthropic/claude-haiku-4-5' },
        },
      ]),
    );
    const list = screen.getByRole('list', { name: 'Problems in this node' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    // A heading under the inspector's own, as large as the rows it heads.
    expect(
      screen.getByRole('heading', { level: 4, name: 'Problems in this node' }),
    ).toHaveClass('text-sm');
    // A static list: nothing in it is a "go to" button.
    expect(within(list).queryByRole('button')).toBeNull();
  });

  it('opens Control flow when a problem is in it', () => {
    const plain = { id: 'summary', type: 'llm', prompt: 'Hi' };
    const { container } = inspector(
      views([
        {
          level: 'error',
          code: 'ITEM_OUT_OF_SCOPE',
          message: 'item is not defined in when',
          at: { pointer: '/nodes/0/when' },
          params: { node: 'summary', field: 'when' },
        },
      ]),
      undefined,
      plain,
    );
    const details = [...container.querySelectorAll('details')].find((d) =>
      d.textContent?.includes('Control flow'),
    );
    expect(details).toHaveAttribute('open');
  });

  it('takes the reader to the field and selects the offending text', async () => {
    const { user } = inspector(
      views([promptError]),
      <GoTo anchor="/nodes/0/prompt" range={[4, 12]} />,
    );
    await user.click(screen.getByRole('button', { name: 'go to' }));
    const prompt = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Prompt',
    });
    // The field first makes sure its tab is the one shown.
    await waitFor(() => expect(prompt).toHaveFocus());
    expect([prompt.selectionStart, prompt.selectionEnd]).toEqual([4, 12]);
  });

  it('takes the reader to the node for a problem with the node as a whole', async () => {
    const { user } = inspector([], <GoTo anchor="/nodes/0" />);
    await user.click(screen.getByRole('button', { name: 'go to' }));
    expect(screen.getByText('Summary', { selector: 'span' })).toHaveFocus();
  });

  it('passes an axe audit with problems shown', async () => {
    const { container } = inspector(
      views([
        promptError,
        {
          level: 'warning',
          code: 'LLM_MODEL_UNAVAILABLE',
          message: 'no provider serves the model',
          at: { pointer: '/nodes/0/model' },
          params: { node: 'summary', model: 'anthropic/claude-haiku-4-5' },
        },
      ]),
    );
    await checkAccessibility(container);
  });
});

describe('NodeInspector header, When it runs and tabs', () => {
  const calc = { id: 'calc', type: 'transform', code: 'return { count: 1 };' };
  const doc = { version: 1, name: 'support/reply', nodes: [calc, llmNode] };
  const context: InspectorContext = {
    ...baseContext,
    doc,
    flow: analyzeFlow(doc.nodes),
    shapeStatus: 'ready',
  };

  function inspect(
    node: NodeDef,
    overrides: Partial<InspectorContext> = {},
    onChange = vi.fn(),
  ) {
    return render(
      <NodeInspector
        id="inspector"
        node={node}
        nodeType={coreNodeTypes().find((def) => def.type === node.type)}
        readOnly={false}
        organizationId="org_test"
        context={{ ...context, ...overrides }}
        onChange={onChange}
      />,
    );
  }

  it('names the node by its title, says what kind it is and copies its id', () => {
    inspect(llmNode);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Summary' }),
    ).toBeVisible();
    expect(
      screen.getByText('Language model · anthropic/claude-haiku-4-5'),
    ).toBeVisible();
    expect(screen.getByText('summary', { selector: 'code' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy node ID' })).toBeVisible();
  });

  it('says how often the node runs, how it is skipped and what a failure does', () => {
    inspect(llmNode, {
      analysis: {
        nodes: { summary: { failureReasons: ['external'] } },
        paths: { count: 2, truncated: false, halts: [] },
        output: { reads: [], maybeEmpty: false },
      },
    });
    const section = screen.getByRole('region', { name: 'When it runs' });
    expect(within(section).getByText('On 1 of 2 paths')).toBeVisible();
    expect(
      within(section).getByText('Skipped when its condition is false'),
    ).toBeVisible();
    expect(
      within(section).getByText('If it fails, the run stops with its error.'),
    ).toBeVisible();
    expect(
      within(section).getByText('Fails when a service it calls fails.'),
    ).toBeVisible();
  });

  it('counts the readers a failure that goes on skips', () => {
    const report = {
      id: 'report',
      type: 'transform',
      code: 'return 1;',
      input: { text: '{{ nodes.calc.output.count }}' },
    };
    const goesOn = { ...calc, onError: 'continue' as const };
    const nodes = [goesOn, report];
    inspect(goesOn, {
      doc: { ...doc, nodes },
      flow: analyzeFlow(nodes),
    });
    expect(
      screen.getByText(
        'If it fails, the run goes on without it and skips 1 node that reads it.',
      ),
    ).toBeVisible();
    // Going on after a failure is a way of producing nothing.
    expect(screen.getByText('Skipped when it fails')).toBeVisible();
  });

  it('shows Fields and Shape, and Last run only while a run is shown', async () => {
    const { user } = inspect(llmNode);
    expect(screen.getByRole('tab', { name: 'Fields' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Last run' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Shape' }));
    expect(screen.getByRole('heading', { name: 'Read by' })).toBeVisible();
  });

  it('has no Shape tab where nothing checks the document', () => {
    inspect(llmNode, { shapeStatus: 'off' });
    expect(screen.queryByRole('tab', { name: 'Shape' })).toBeNull();
  });

  it('keeps a half-typed field across a look at the shapes', async () => {
    const { user } = inspect({ ...calc, input: { a: 1 } });
    const input = screen.getByRole('textbox', { name: 'Input' });
    await user.clear(input);
    await user.type(input, '[[');
    await user.click(screen.getByRole('tab', { name: 'Shape' }));
    await user.click(screen.getByRole('tab', { name: 'Fields' }));
    expect(screen.getByRole('textbox', { name: 'Input' })).toHaveValue('[');
  });
});

describe('NodeInspector fields', () => {
  const doc = {
    version: 1,
    name: 'support/reply',
    nodes: [
      { id: 'calc', type: 'transform', code: 'return 1;' },
      { id: 'triage', type: 'llm', prompt: 'Hi', when: 'input.urgent' },
      { id: 'fallback', type: 'llm', prompt: 'Hi', elseOf: 'triage' },
      llmNode,
    ],
  };
  const context: InspectorContext = { ...baseContext, doc };
  const typeOf = (node: NodeDef) =>
    coreNodeTypes().find((def) => def.type === node.type);

  function inspect(node: NodeDef, onChange = vi.fn()) {
    return render(
      <NodeInspector
        id="inspector"
        node={node}
        nodeType={typeOf(node)}
        readOnly={false}
        organizationId="org_test"
        context={context}
        onChange={onChange}
      />,
    );
  }

  const languageOf = (name: string) =>
    screen.getByRole('textbox', { name }).getAttribute('data-language');

  it('edits every code field in the code editor, in its language', () => {
    inspect({
      ...llmNode,
      system: 'Be brief.',
      forEach: '{{ nodes.calc.output }}',
      repeatUntil: 'output.done',
    });
    expect(languageOf('Prompt')).toBe('markdown');
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
      'data-templates',
    );
    expect(languageOf('System prompt')).toBe('markdown');
    expect(languageOf('Input')).toBe('json');
    // A condition is one expression until it holds a template.
    expect(languageOf('When')).toBe('template');
    expect(languageOf('Repeat until')).toBe('expression');
    expect(languageOf('For each')).toBe('template');
  });

  it('edits transform code as JavaScript', () => {
    inspect({ id: 'calc', type: 'transform', code: 'return 1;' });
    expect(languageOf('Code')).toBe('javascript');
  });

  it('says a condition in words under it', () => {
    inspect({ ...llmNode, when: 'input.urgent' });
    expect(
      screen.getByText(
        /^Runs only if .+\. Otherwise it's skipped, and so is every node that reads its output\.$/,
      ),
    ).toBeVisible();
  });

  it('sets On error to go on without the node, and back', async () => {
    const onChange = vi.fn();
    const { user } = inspect(llmNode, onChange);
    await user.click(
      screen.getByRole('radio', { name: 'Continue without it' }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ onError: 'continue' });
    expect(
      screen.getByText(/^What happens when this node fails\./),
    ).toBeVisible();
  });

  it('removes On error when the run should stop', async () => {
    const onChange = vi.fn();
    const { user } = inspect({ ...llmNode, onError: 'continue' }, onChange);
    await user.click(screen.getByRole('radio', { name: 'Stop the run' }));
    expect(onChange).toHaveBeenLastCalledWith({ onError: undefined });
  });

  it('offers Maximum repeats only beside Repeat until, and refuses 25', async () => {
    const onChange = vi.fn();
    const { user, unmount } = inspect(llmNode, onChange);
    expect(
      screen.queryByRole('spinbutton', { name: 'Maximum repeats' }),
    ).toBeNull();
    unmount();
    const second = inspect(
      { ...llmNode, repeatUntil: 'output.done' },
      onChange,
    );
    const box = screen.getByRole('spinbutton', { name: 'Maximum repeats' });
    await second.user.type(box, '25');
    expect(
      screen.getByText('Enter a whole number from 1 to 20.'),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalledWith({ maxRepeats: 25 });
    await second.user.clear(box);
    await second.user.type(box, '3');
    expect(onChange).toHaveBeenLastCalledWith({ maxRepeats: 3 });
    void user;
  });

  it('offers only nodes with a condition as Else of, never itself or its own partner', () => {
    const triage = { id: 'triage', type: 'llm', prompt: 'Hi', when: 'input.a' };
    const fallback = {
      id: 'fallback',
      type: 'llm',
      prompt: 'Hi',
      when: 'input.b',
      elseOf: 'triage',
    };
    render(
      <NodeInspector
        id="inspector"
        node={triage}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        context={{
          ...baseContext,
          doc: {
            ...doc,
            nodes: [{ id: 'calc', type: 'transform' }, triage, fallback],
          },
        }}
        onChange={vi.fn()}
      />,
    );
    // Fallback has a condition, but it is already Triage's otherwise:
    // pairing the two both ways would make each wait on the other.
    expect(screen.getByText('No other node has a condition.')).toBeVisible();
  });

  it('pairs a node with a condition as its otherwise', async () => {
    const onChange = vi.fn();
    const { user } = inspect(llmNode, onChange);
    await user.click(screen.getByRole('button', { name: /^Else of/ }));
    await user.click(await screen.findByRole('option', { name: /Triage/ }));
    expect(onChange).toHaveBeenLastCalledWith({ elseOf: 'triage' });
  });
});

describe('NodeInspector JSON fields', () => {
  /** The inspector over a node it really edits: each patch lands on the
   *  node and comes back, as the editor's draft does it. */
  function Harness({ onNode }: { onNode: (node: NodeDef) => void }) {
    const [node, setNode] = useState<NodeDef>({
      id: 'calc',
      type: 'transform',
      code: 'return input;',
    });
    return (
      <NodeInspector
        id="inspector"
        node={node}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
        context={baseContext}
        onChange={(patch) => {
          setNode((current) => {
            const updated: NodeDef = { ...current, ...patch };
            for (const [key, value] of Object.entries(patch)) {
              if (value === undefined) Reflect.deleteProperty(updated, key);
            }
            onNode(updated);
            return updated;
          });
        }}
      />
    );
  }

  it('never moves the caret while typing, and keeps the node on a scalar', async () => {
    const seen: NodeDef[] = [];
    const { user } = render(<Harness onNode={(node) => seen.push(node)} />);
    const input = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Input',
    });
    const typed = '{"a":1}';
    for (let i = 0; i < typed.length; i++) {
      const key = typed[i] === '{' ? '{{' : (typed[i] ?? '');
      await user.type(input, key);
      // The text is the author's own: a value parsed from it never comes
      // back reformatted, so the caret stays at the end of what was typed.
      expect(input).toHaveValue(typed.slice(0, i + 1));
      expect(input.selectionStart).toBe(i + 1);
    }
    expect(seen.at(-1)?.input).toEqual({ a: 1 });

    await user.clear(input);
    await user.type(input, '1');
    expect(
      screen.getByText('This must be a JSON object, in curly braces.'),
    ).toBeVisible();
    expect(seen.at(-1)?.input).toBeUndefined();
  });
});
