import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { coreNodeTypes } from '../hooks/backend';
import { NodeInspector } from './node-inspector';

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
const transformType = coreNodeTypes().find((def) => def.type === 'transform');

const llmNode = {
  id: 'summary',
  type: 'llm',
  model: 'anthropic/claude-haiku-4-5',
  prompt: 'One sentence, please.',
  when: '{{ nodes.calc.output.count > 0 }}',
};

describe('NodeInspector', () => {
  it('asks the author to pick a node when none is selected', () => {
    render(
      <NodeInspector
        id="inspector"
        node={null}
        nodeType={undefined}
        readOnly={false}
        organizationId="org_test"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/select a node on the canvas/i)).toBeVisible();
  });

  it('shows the workflow slot when no node is selected', () => {
    const { container } = render(
      <NodeInspector
        id="inspector"
        node={null}
        nodeType={undefined}
        readOnly={false}
        organizationId="org_test"
        onChange={vi.fn()}
        workflow={<p>workflow body</p>}
      />,
    );
    expect(screen.getByText('workflow body')).toBeVisible();
    expect(screen.queryByText(/select a node on the canvas/i)).toBeNull();
    // Same height as the canvas column — Save is pinned to the bottom of the
    // panel rather than leaving a short card beside a tall graph.
    expect(container.querySelector('section#inspector')).toHaveClass('h-full');
  });

  it('hides the workflow slot while a node is selected', () => {
    const { container } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        onChange={vi.fn()}
        workflow={<p>workflow body</p>}
      />,
    );
    expect(screen.queryByText('workflow body')).not.toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeVisible();
    expect(container.querySelector('section#inspector')).toHaveClass('h-full');
  });

  it('renders exactly the fields the registry declares for the type', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
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
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue(
      '{{ nodes.calc.output.count > 0 }}',
    );
    expect(screen.getByRole('textbox', { name: 'For each' })).toHaveValue('');
  });

  it('keeps unused control flow behind a disclosure', async () => {
    const { user } = render(
      <NodeInspector
        id="inspector"
        node={{ id: 'calc', type: 'transform', code: 'return 1;' }}
        nodeType={transformType}
        readOnly={false}
        organizationId="org_test"
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
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Unknown node type: acme.ping')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Input' })).toBeVisible();
    expect(
      screen.getByText(/couldn't load the node-type catalog/i),
    ).toBeVisible();
  });

  it('shows what the overlaid run did to this node, effects included', () => {
    render(
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
      />,
    );
    expect(screen.getByText('In this run')).toBeVisible();
    expect(screen.getByText('slack.post_message')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
      'readonly',
    );
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
        onChange={vi.fn()}
        onDeselect={onDeselect}
      />,
    );
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }));
    await user.keyboard('{Escape}');
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('moves focus into the inspector when a node is selected', () => {
    const { rerender } = render(
      <NodeInspector
        id="inspector"
        node={null}
        nodeType={undefined}
        readOnly={false}
        organizationId="org_test"
        onChange={vi.fn()}
        workflow={<p>workflow body</p>}
        onDeselect={vi.fn()}
      />,
    );
    expect(document.getElementById('inspector')).not.toHaveFocus();
    rerender(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        organizationId="org_test"
        onChange={vi.fn()}
        workflow={<p>workflow body</p>}
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
        onChange={vi.fn()}
        onDeselect={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });
});
