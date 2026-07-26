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
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/select a node on the canvas/i)).toBeVisible();
  });

  it('renders exactly the fields the registry declares for the type', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
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
        onChange={onChange}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Input' }), '{{');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/not valid json yet/i)).toBeVisible();
  });

  it('shows the control-flow fields every node type accepts', () => {
    render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'When' })).toHaveValue(
      '{{ nodes.calc.output.count > 0 }}',
    );
    expect(screen.getByRole('textbox', { name: 'For each' })).toHaveValue('');
  });

  it('still shows the node when the catalog does not know its type', () => {
    render(
      <NodeInspector
        id="inspector"
        node={{ id: 'ping', type: 'acme.ping' }}
        nodeType={undefined}
        catalogUnavailable
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Unknown node type: acme.ping')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Input' })).toBeVisible();
    expect(
      screen.getByText(
        /catalogue could not be loaded|catalog could not be loaded/i,
      ),
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
              integration: 'slack.post_message',
              input: { text: 'done' },
            },
          ],
        }}
        readOnly
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('In this run')).toBeVisible();
    expect(screen.getByText('slack.post_message')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toHaveAttribute(
      'readonly',
    );
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <NodeInspector
        id="inspector"
        node={llmNode}
        nodeType={llmType}
        readOnly={false}
        onChange={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });
});
