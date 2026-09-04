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
vi.mock('@/app/components/ui/data-display/json-viewer', () => ({
  JsonViewer: ({ data }: { data: unknown }) => (
    <pre data-testid="json">{JSON.stringify(data)}</pre>
  ),
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
    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue(
      'anthropic/claude-haiku-4-5',
    );
    // `code` belongs to `transform`, not to `llm`.
    expect(screen.queryByRole('textbox', { name: 'Code' })).toBeNull();
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
