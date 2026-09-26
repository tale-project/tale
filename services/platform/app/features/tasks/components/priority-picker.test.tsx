// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { PriorityPicker } from './priority-picker';

describe('PriorityPicker', () => {
  it('keeps the bare glyph on cards and rows', () => {
    render(<PriorityPicker priority="p0" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Priority' });
    expect(trigger).not.toHaveTextContent('Urgent');
  });

  it('names the priority beside its glyph in a property list', () => {
    render(<PriorityPicker priority="p0" onChange={vi.fn()} showLabel />);
    const trigger = screen.getByRole('button', { name: 'Priority: Urgent' });
    expect(trigger).toHaveTextContent('Urgent');
  });

  it('reads the empty state out loud too', () => {
    render(<PriorityPicker priority={null} onChange={vi.fn()} showLabel />);
    expect(
      screen.getByRole('button', { name: 'Priority: No priority' }),
    ).toHaveTextContent('No priority');
  });

  it('shows the label as text when the task cannot be edited', () => {
    render(
      <PriorityPicker priority="p1" onChange={vi.fn()} disabled showLabel />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});
