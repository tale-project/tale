import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NodeStatusIcon, RunBadge, RunStatusBadge } from './run-status-badge';

// `Badge` hardcodes the className on the icon it renders, so a running run can
// only spin if the icon component spins itself. A regression here is silent —
// the badge still renders, it just freezes — hence an explicit class assertion.

describe('run status icons', () => {
  it('shows a legacy hold without claiming work or recovery is running', () => {
    const { container } = render(<RunBadge status="quarantined" stalled />);
    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(screen.queryByText('Interrupted — resuming')).toBeNull();
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
  });

  it('spins the running run badge, and respects reduced motion', () => {
    const { container } = render(<RunBadge status="running" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass('animate-spin');
    expect(svg).toHaveClass('motion-reduce:animate-none');
  });

  it('leaves a settled run badge still', () => {
    const { container } = render(<RunBadge status="success" />);
    expect(container.querySelector('svg')).not.toHaveClass('animate-spin');
  });

  it('spins a running node badge but leaves settled ones still', () => {
    const running = render(<RunStatusBadge status="running" />);
    expect(running.container.querySelector('svg')).toHaveClass('animate-spin');
    running.unmount();

    const settled = render(<RunStatusBadge status="ok" />);
    expect(settled.container.querySelector('svg')).not.toHaveClass(
      'animate-spin',
    );
  });

  it('spins the icon-only running node in the step timeline', () => {
    render(<NodeStatusIcon status="running" />);
    // The status word stays readable to a screen reader — that label IS the icon.
    const icon = screen.getByRole('img', { name: 'Running now' });
    expect(icon).toHaveClass('animate-spin');
    expect(icon).toHaveClass('motion-reduce:animate-none');
  });

  it('leaves a settled icon-only node still', () => {
    render(<NodeStatusIcon status="ok" />);
    expect(screen.getByRole('img', { name: 'Ran' })).not.toHaveClass(
      'animate-spin',
    );
  });
});

describe('an interrupted run', () => {
  it('reads Interrupted with a still icon while it waits for a server', () => {
    const { container } = render(<RunBadge status="running" stalled />);
    // Its own word, never colour alone, and nothing spins: no server is
    // working on it yet.
    expect(screen.getByText('Interrupted — resuming')).toBeInTheDocument();
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveClass('lucide-refresh-cw');
    expect(svg).not.toHaveClass('animate-spin');
  });

  it('reads Running again once a server took it over', () => {
    render(<RunBadge status="running" stalled={false} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Interrupted — resuming')).toBeNull();
  });

  it('never marks a run that is not running as interrupted', () => {
    render(<RunBadge status="waiting" stalled />);
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });
});

describe('the node a run is on, when nobody is running it', () => {
  it.each([
    ['waiting', 'Waiting here', 'lucide-clock'],
    ['interrupted', 'Interrupted here', 'lucide-refresh-cw'],
  ] as const)('reads %s in words, with a still icon', (status, word, icon) => {
    const { container } = render(<RunStatusBadge status={status} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass(icon);
    expect(svg).not.toHaveClass('animate-spin');
  });

  it('keeps the interrupted run badge apart from the orange Live badge beside it', () => {
    const { container } = render(<RunBadge status="running" stalled />);
    expect(container.firstElementChild?.className).not.toMatch(/orange/);
  });
});
