import type { RowSelectionState } from '@tanstack/react-table';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { BulkArchiveBar, BulkDeleteBar } from './data-table-bulk-actions';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: toastMock,
}));

describe('BulkDeleteBar', () => {
  const defaultProps = {
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
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
      screen.getByText(/delete these 2 items\? this can't be undone/i),
    ).toBeInTheDocument();
  });

  describe('when a delete is refused', () => {
    const refusal = new Error('Refused');
    const onDeleteItem = vi.fn(async (id: string) => {
      if (id === 'id2') throw refusal;
    });

    async function deleteBoth(
      describeFailure?: (reasons: unknown[]) => string,
    ) {
      toastMock.mockClear();
      const { user } = render(
        <BulkDeleteBar
          {...defaultProps}
          rowSelection={{ id1: true, id2: true }}
          onDeleteItem={onDeleteItem}
          describeFailure={describeFailure}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: /delete selected/i }),
      );
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: /^delete$/i,
        }),
      );
      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      return toastMock.mock.calls[0]?.[0];
    }

    it('shows only its title by default', async () => {
      expect(await deleteBoth()).toEqual({
        title: "Couldn't delete some items",
        description: undefined,
        variant: 'destructive',
      });
    });

    // The one toast of a batch used to drop why it failed, so a caller
    // whose own write hook stays silent showed no reason at all.
    it("says why, in the caller's words for the refusals", async () => {
      const describeFailure = vi.fn(() => 'Your session has ended.');
      expect(await deleteBoth(describeFailure)).toEqual({
        title: "Couldn't delete some items",
        description: 'Your session has ended.',
        variant: 'destructive',
      });
      expect(describeFailure).toHaveBeenCalledWith([refusal]);
    });
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

describe('BulkArchiveBar', () => {
  const defaultProps = {
    rowSelection: {},
    onRowSelectionChange: vi.fn(),
    onClearSelection: vi.fn(),
    onArchiveItem: vi.fn().mockResolvedValue(undefined),
  };

  it('renders nothing when no rows are selected', () => {
    const { container } = render(<BulkArchiveBar {...defaultProps} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders archive, not delete, when rows are selected', () => {
    render(
      <BulkArchiveBar
        {...defaultProps}
        rowSelection={{ id1: true, id2: true }}
      />,
    );

    expect(screen.getByText(/2 items selected/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /archive selected/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete selected/i }),
    ).not.toBeInTheDocument();
  });

  it('opens a confirm dialog that mentions restore', async () => {
    const { user } = render(
      <BulkArchiveBar
        {...defaultProps}
        rowSelection={{ id1: true, id2: true }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /archive selected/i }));

    expect(
      screen.getByText(/archive these 2 items\? you can restore them later/i),
    ).toBeInTheDocument();
  });

  describe('when an archive is refused', () => {
    const refusal = new Error('Refused');
    const onArchiveItem = vi.fn(async (id: string) => {
      if (id === 'id2') throw refusal;
    });

    async function archiveBoth(
      describeFailure?: (reasons: unknown[]) => string,
    ) {
      toastMock.mockClear();
      const { user } = render(
        <BulkArchiveBar
          {...defaultProps}
          rowSelection={{ id1: true, id2: true }}
          onArchiveItem={onArchiveItem}
          describeFailure={describeFailure}
        />,
      );
      await user.click(
        screen.getByRole('button', { name: /archive selected/i }),
      );
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: /archive selected/i,
        }),
      );
      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      return toastMock.mock.calls[0]?.[0];
    }

    it('shows only its title by default', async () => {
      expect(await archiveBoth()).toEqual({
        title: "Couldn't archive some items",
        description: undefined,
        variant: 'destructive',
      });
    });

    // Its one toast is the batch's only report once each archive's own
    // write stays quiet, so it must carry why the refusals happened.
    it("says why, in the caller's words for the refusals", async () => {
      const describeFailure = vi.fn(() => 'Your session has ended.');
      expect(await archiveBoth(describeFailure)).toEqual({
        title: "Couldn't archive some items",
        description: 'Your session has ended.',
        variant: 'destructive',
      });
      expect(describeFailure).toHaveBeenCalledWith([refusal]);
    });
  });
});

describe.each(['delete', 'archive'] as const)('%s recovery', (action) => {
  it.each(['mixed', 'refused', 'success'] as const)(
    'preserves the recovery context for %s and retries only failures',
    async (outcome) => {
      const onClear = vi.fn();
      const onComplete = vi.fn();
      let retry = false;
      const operate = vi.fn(async (id: string) => {
        if (
          !retry &&
          (outcome === 'refused' || (outcome === 'mixed' && id === 'bravo'))
        ) {
          throw new Error('Not allowed');
        }
      });
      const labels: Record<string, string> = {
        alpha: 'Selected Alpha',
        bravo: 'Selected Bravo',
        charlie: 'Unselected Charlie',
      };
      function Fixture() {
        const [selection, setSelection] = useState<RowSelectionState>({
          alpha: true,
          bravo: true,
          charlie: false,
        });
        const clear = () => {
          onClear();
          setSelection({});
        };
        const complete = () => {
          onComplete();
          setSelection({});
        };
        const props = {
          rowSelection: selection,
          onRowSelectionChange: setSelection,
          onClearSelection: clear,
          getItemLabel: (id: string) => labels[id] ?? id,
          describeFailure: () => 'Not allowed',
        };
        return (
          <>
            {Object.entries(labels).map(([id, label]) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={id in selection && selection[id]}
                  onChange={() =>
                    setSelection((current) => ({
                      ...current,
                      [id]: !current[id],
                    }))
                  }
                />
                {label}
              </label>
            ))}
            {action === 'delete' ? (
              <BulkDeleteBar
                {...props}
                onDeleteItem={operate}
                onDeleteComplete={complete}
              />
            ) : (
              <BulkArchiveBar
                {...props}
                onArchiveItem={operate}
                onComplete={complete}
              />
            )}
          </>
        );
      }
      toastMock.mockClear();
      const { user } = render(<Fixture />);
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(`${action} selected`, 'i'),
        }),
      );
      const confirm = () =>
        within(screen.getByRole('dialog')).getByRole('button', {
          name: action === 'delete' ? /^delete$/i : /archive selected/i,
        });
      await user.click(confirm());
      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      expect(operate.mock.calls.map(([id]) => id)).toEqual(['alpha', 'bravo']);
      expect(screen.getByLabelText('Unselected Charlie')).not.toBeChecked();
      if (outcome !== 'success') {
        expect(onClear).not.toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(screen.getByLabelText('Selected Bravo')).toBeChecked();
        const failedIds = outcome === 'mixed' ? ['bravo'] : ['alpha', 'bravo'];
        if (outcome === 'refused')
          expect(screen.getByLabelText('Selected Alpha')).toBeChecked();
        else expect(screen.getByLabelText('Selected Alpha')).not.toBeChecked();
        const alert = within(screen.getByRole('dialog')).getByRole('alert');
        expect(within(alert).getByText('Not allowed')).toBeInTheDocument();
        expect(within(alert).getByText('Selected Bravo')).toBeInTheDocument();
        if (outcome === 'mixed')
          expect(
            within(alert).queryByText('Selected Alpha'),
          ).not.toBeInTheDocument();
        await user.click(
          within(screen.getByRole('dialog')).getByRole('button', {
            name: /cancel/i,
          }),
        );
        await waitFor(() =>
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
        );
        expect(screen.getByLabelText('Selected Bravo')).toBeChecked();
        await user.click(
          screen.getByRole('button', {
            name: new RegExp(`${action} selected`, 'i'),
          }),
        );
        retry = true;
        operate.mockClear();
        await user.click(confirm());
        await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
        expect(operate.mock.calls.map(([id]) => id)).toEqual(failedIds);
      }
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(onClear).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Selected Alpha')).not.toBeChecked();
      expect(screen.getByLabelText('Selected Bravo')).not.toBeChecked();
      expect(
        screen.queryByRole('button', {
          name: new RegExp(`${action} selected`, 'i'),
        }),
      ).not.toBeInTheDocument();
    },
  );
});
