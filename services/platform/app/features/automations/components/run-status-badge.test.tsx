import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NodeStatusIcon, RunBadge, RunStatusBadge } from './run-status-badge';

// `Badge` hardcodes the className on the icon it renders, so a running run can
// only spin if the icon component spins itself. A regression here is silent —
// the badge still renders, it just freezes — hence an explicit class assertion.

describe('run status icons', () => {
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
