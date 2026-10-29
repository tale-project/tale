import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import {
  FLOW_NODE_STATE,
  FlowNodeStatusBadge,
  FlowNodeStatusIcon,
  type FlowShownState,
} from './node-status';

const STATES = Object.keys(FLOW_NODE_STATE) as FlowShownState[];

describe('the flow node status vocabulary', () => {
  it('gives every state its own glyph and its own word', () => {
    const icons = new Set(STATES.map((state) => FLOW_NODE_STATE[state].icon));
    expect(icons.size).toBe(STATES.length);
    for (const state of STATES) {
      render(<FlowNodeStatusIcon state={state} />);
    }
    const names = screen
      .getAllByRole('img')
      .map((img) => img.getAttribute('aria-label'));
    expect(names).toEqual([
      'Not reached yet',
      'Running',
      'Waiting',
      'Succeeded',
      'Failed',
      'Skipped',
      'Stopped here',
      'Not run',
      'Reused',
    ]);
  });

  it('never paints a glyph in slate-400, which is too faint', () => {
    for (const state of STATES)
      expect(FLOW_NODE_STATE[state].iconClass).not.toMatch(/slate-400/);
  });

  it('shows nothing while no run is shown', () => {
    const { container } = render(
      <>
        <FlowNodeStatusIcon state="idle" />
        <FlowNodeStatusBadge state="idle" />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says the state in a badge', () => {
    render(<FlowNodeStatusBadge state="failed" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
