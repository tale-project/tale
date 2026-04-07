import { describe, it, expect, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { BulkDeleteBar } from './data-table-bulk-actions';

describe('BulkDeleteBar', () => {
  const defaultProps = {
    rowSelection: {},
    onClearSelection: vi.fn(),
    onDeleteItem: vi.fn().mockResolvedValue(undefined),
  };

  it('renders nothing when no rows are selected', () => {
    const { container } = render(<BulkDeleteBar {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders selection count and delete button when rows are selected', () => {
    render(
      <BulkDeleteBar
        {...defaultProps}
        rowSelection={{ id1: true, id2: true }}
      />,
    );

    expect(screen.getByText(/2 items selected/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /delete selected/i }),
    ).toBeInTheDocument();
  });

  it('renders singular text for single selection', () => {
    render(<BulkDeleteBar {...defaultProps} rowSelection={{ id1: true }} />);

    expect(screen.getByText(/1 item selected/)).toBeInTheDocument();
  });

  it('calls onClearSelection when clear button is clicked', async () => {
    const onClearSelection = vi.fn();
    const { user } = render(
      <BulkDeleteBar
        {...defaultProps}
        rowSelection={{ id1: true }}
        onClearSelection={onClearSelection}
      />,
    );

    const clearButton = screen.getByRole('button', { name: /clear all/i });
    await user.click(clearButton);

    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('opens confirmation dialog when delete button is clicked', async () => {
    const { user } = render(
      <BulkDeleteBar
        {...defaultProps}
        rowSelection={{ id1: true, id2: true }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /delete selected/i }));

    expect(
      screen.getByText(/are you sure you want to delete these 2 items/i),
    ).toBeInTheDocument();
  });

  it('filters out false-valued selection entries', () => {
    render(
      <BulkDeleteBar
        {...defaultProps}
        rowSelection={{ id1: true, id2: false, id3: true }}
      />,
    );

    expect(screen.getByText(/2 items selected/)).toBeInTheDocument();
  });
});
