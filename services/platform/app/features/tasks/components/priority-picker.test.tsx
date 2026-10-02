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

  // #4062: a board renders a picker on every card; a closed one builds no
  // list. The trigger still reads as the popup button it opens.
  it('mounts its list on first use and hands focus back to the trigger on close', async () => {
    const { user } = render(
      <PriorityPicker priority="p2" onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole('button', { name: 'Priority' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.keyboard('{Escape}');

    await vi.waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );
    const restored = screen.getByRole('button', { name: 'Priority' });
    expect(restored).toHaveFocus();
    expect(restored).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens from the keyboard and sets the picked priority', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <PriorityPicker priority={null} onChange={onChange} />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.click(screen.getByRole('option', { name: /Urgent/ }));

    expect(onChange).toHaveBeenCalledWith('p0');
  });

  it('reopens the mounted list on a later click', async () => {
    const { user } = render(
      <PriorityPicker priority="p1" onChange={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Priority' }));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    await vi.waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: 'Priority' }));

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});
