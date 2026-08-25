import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AutomationNodeBox } from './automation-node';

/**
 * The node box is the canvas's whole keyboard story: it is a real button, so
 * Tab reaches it, Enter and Space activate it, and it announces that it expands
 * the inspector. If any of that regresses the canvas becomes pointer-only,
 * which is a defect rather than a rough edge.
 */

const node = {
  id: 'send_digest',
  type: 'slack.post_message',
  when: '{{ nodes.calc.output.count > 0 }}',
  input: { text: '{{ nodes.calc.output.summary }}' },
};

/** jsdom approximates `:focus-visible` with event bookkeeping that leaks
 * across the tests sharing one document, so its verdict is order-dependent.
 * Pin the verdict to test each branch of the box's focus guard; the heuristic
 * itself is the browser's contract, not ours. */
function stubFocusVisible(element: Element, verdict: boolean) {
  const realMatches = element.matches.bind(element);
  vi.spyOn(element, 'matches').mockImplementation((selector: string) =>
    selector === ':focus-visible' ? verdict : realMatches(selector),
  );
}

describe('AutomationNodeBox', () => {
  it('is a button that names the node and its type', () => {
    render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={['calc']}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(/send digest/i);
    expect(button).toHaveAccessibleName(/slack\.post_message/i);
  });

  it('activates with the keyboard, not just a pointer', async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={onSelect}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button')).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('announces whether the inspector is open for this node', () => {
    const { rerender } = render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    rerender(
      <AutomationNodeBox
        node={node}
        selected
        inspectorId="inspector"
        sources={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-controls',
      'inspector',
    );
  });

  it('spells out the nodes it reads, so the edges are readable without seeing them', () => {
    render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={['calc', 'fetch_orders']}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toHaveAccessibleName(
      /calc, fetch orders/i,
    );
  });

  it('shows the control flow and the run status as words, not only colour', () => {
    render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        runStatus="error"
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(/failed/i);
    expect(button).toHaveAccessibleName(/when/i);
  });

  it('marks an agent whose model has no pinned provider', () => {
    render(
      <AutomationNodeBox
        node={{ id: 'agent', type: 'agent', model: 'claude-sonnet-4' }}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(/no pinned provider/i);
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('stays quiet when the agent model is pinned', () => {
    render(
      <AutomationNodeBox
        node={{
          id: 'agent',
          type: 'agent',
          model: 'claude-sonnet-4',
          modelProvider: 'anthropic',
        }}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).not.toHaveAccessibleName(
      /no pinned provider/i,
    );
  });

  it('calls back on focus so the viewport can follow a keyboard user', async () => {
    const onFocus = vi.fn();
    const { user } = render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={vi.fn()}
        onFocus={onFocus}
      />,
    );
    stubFocusVisible(screen.getByRole('button'), true);
    await user.tab();
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('ignores pointer focus, which would pan the box out from under the click', async () => {
    const onFocus = vi.fn();
    const onSelect = vi.fn();
    const { user } = render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={[]}
        onSelect={onSelect}
        onFocus={onFocus}
      />,
    );
    const button = screen.getByRole('button');
    stubFocusVisible(button, false);
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <AutomationNodeBox
        node={node}
        selected={false}
        inspectorId="inspector"
        sources={['calc']}
        runStatus="ok"
        onSelect={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });
});
