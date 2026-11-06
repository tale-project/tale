import { Brain, Wrench } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { TimelineRow } from './timeline-row';

describe('TimelineRow', () => {
  it('is an inert line with a spacer where the chevron would be', () => {
    render(<TimelineRow icon={Wrench} label="Read example.com" />);
    const row = screen.getByTestId('timeline-row');
    expect(row.tagName).toBe('DIV');
    expect(row).toHaveTextContent('Read example.com');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('becomes a disclosure button when it opens something', async () => {
    const onToggle = vi.fn();
    const { user, rerender } = render(
      <TimelineRow
        icon={Brain}
        label="Thought for 4s"
        onToggle={onToggle}
        controls="reasoning"
      />,
    );
    const button = screen.getByRole('button', { name: 'Thought for 4s' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');

    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <TimelineRow
        icon={Brain}
        label="Thought for 4s"
        onToggle={onToggle}
        expanded
        controls="reasoning"
      />,
    );
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'reasoning');
  });

  it('shows a trailing node beside the label', () => {
    render(
      <TimelineRow
        icon={Wrench}
        label="Asked"
        trailing={<span>Approved</span>}
      />,
    );
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <div>
        <TimelineRow icon={Brain} label="Thinking" onToggle={() => {}} />
        <TimelineRow icon={Wrench} label="Searched the knowledge base" />
      </div>,
    );
    await checkAccessibility(container);
  });
});
