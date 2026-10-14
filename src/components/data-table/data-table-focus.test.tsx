import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { DeleteDialog } from '../dialog/delete-dialog';
import { EntityRowActions } from '../entity/entity-row-actions';
import { DataTable } from './data-table';

interface Team {
  id: string;
  name: string;
}

/**
 * How the confirmed delete reaches the list (#3791):
 * - `with-row`: the list drops the row while its dialog is open, and the
 *   dialog, rendered in the row, goes with it (a refetch answered first);
 * - `after-close`: the dialog closes, focus goes back to the row's menu
 *   button, and the refetch drops the row a moment later;
 * - `disabled-then-removed`: as Teams does, the dialog closes and the row
 *   disables its menu button at once, and the refetch drops the row later.
 */
type Order = 'with-row' | 'after-close' | 'disabled-then-removed';

/** Refetches that have not landed yet (`after-close`): the test lands them. */
const pendingRefetches: Array<() => void> = [];

async function landRefetches() {
  await act(async () => {
    for (const refetch of pendingRefetches.splice(0)) refetch();
  });
}

function TeamActions({
  team,
  order,
  onDeleted,
}: {
  team: Team;
  order: Order;
  onDeleted: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <>
      <EntityRowActions
        disabled={deleted}
        ariaLabel={`Actions for ${team.name}`}
        actions={[
          {
            key: 'delete',
            label: 'Delete',
            icon: Trash2,
            destructive: true,
            onClick: () => setOpen(true),
          },
        ]}
      />
      <DeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${team.name}`}
        description="The team is removed for everyone."
        deleteText="Delete"
        onDelete={() => {
          if (order === 'with-row') {
            onDeleted(team.id);
            return;
          }
          setOpen(false);
          if (order === 'disabled-then-removed') setDeleted(true);
          pendingRefetches.push(() => onDeleted(team.id));
        }}
      />
    </>
  );
}

function Teams({
  initial,
  order,
  search = false,
}: {
  initial: Team[];
  order: Order;
  /** A search box puts the create action in the toolbar, not the empty state. */
  search?: boolean;
}) {
  const [teams, setTeams] = useState(initial);
  const onDeleted = (id: string) =>
    setTeams((current) => current.filter((team) => team.id !== id));
  const columns: ColumnDef<Team>[] = [
    { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
    {
      id: 'actions',
      size: 44,
      meta: { isAction: true },
      cell: ({ row }) => (
        <TeamActions team={row.original} order={order} onDeleted={onDeleted} />
      ),
    },
  ];
  return (
    <main tabIndex={-1}>
      <DataTable
        columns={columns}
        data={teams}
        getRowId={(team) => team.id}
        addAction={{ label: 'Create team', icon: Plus, onClick: vi.fn() }}
        emptyState={{ title: 'No teams yet' }}
        search={search ? { value: '', onChange: vi.fn() } : undefined}
      />
      <a href="#help">Help</a>
    </main>
  );
}

const ALPHA = { id: 'alpha', name: 'Alpha' };
const BETA = { id: 'beta', name: 'Beta' };
const GAMMA = { id: 'gamma', name: 'Gamma' };

/** Opens a row's menu from the keyboard, chooses Delete and returns the dialog. */
async function openDelete(
  user: ReturnType<typeof render>['user'],
  name: string,
) {
  const trigger = screen.getByRole('button', { name: `Actions for ${name}` });
  trigger.focus();
  await user.keyboard('{Enter}');
  const item = within(await screen.findByRole('menu')).getByRole('menuitem', {
    name: 'Delete',
  });
  await waitFor(() => expect(item).toHaveFocus());
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return { trigger, dialog };
}

/**
 * Confirms the open delete from the keyboard. In `after-close` the dialog
 * first hands the focus back to the row's menu button; then the refetch
 * lands and takes the row.
 */
async function confirmDelete(
  user: ReturnType<typeof render>['user'],
  dialog: HTMLElement,
  order: Order,
  trigger: HTMLElement,
) {
  within(dialog).getByRole('button', { name: 'Delete' }).focus();
  await user.keyboard('{Enter}');
  if (order === 'with-row') return;
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    if (order === 'after-close') expect(trigger).toHaveFocus();
    // The disabled button cannot take the focus back; it never drops.
    else expect(document.activeElement).not.toBe(document.body);
  });
  await landRefetches();
}

describe('DataTable keeps the focus in the list when a row leaves (#3791)', () => {
  describe.each<Order>(['with-row', 'after-close', 'disabled-then-removed'])(
    'when the row leaves %s',
    (order) => {
      it("moves to the next row's menu button when other rows are left", async () => {
        const { user } = render(
          <Teams initial={[ALPHA, BETA, GAMMA]} order={order} />,
        );
        const { dialog, trigger } = await openDelete(user, 'Beta');
        await confirmDelete(user, dialog, order, trigger);

        await waitFor(() => {
          expect(screen.queryByText('Beta')).not.toBeInTheDocument();
          expect(
            screen.getByRole('button', { name: 'Actions for Gamma' }),
          ).toHaveFocus();
        });
        // The next Tab stays in the list, never back at the page's top.
        await user.tab();
        expect(screen.getByRole('main')).toContainElement(
          document.activeElement as HTMLElement,
        );
      });

      it('moves to the row above when the last row of several leaves', async () => {
        const { user } = render(
          <Teams initial={[ALPHA, BETA]} order={order} />,
        );
        const { dialog, trigger } = await openDelete(user, 'Beta');
        await confirmDelete(user, dialog, order, trigger);

        await waitFor(() => {
          expect(screen.queryByText('Beta')).not.toBeInTheDocument();
          expect(
            screen.getByRole('button', { name: 'Actions for Alpha' }),
          ).toHaveFocus();
        });
      });

      it("moves to the toolbar's create action, past a disabled search, when the only row leaves", async () => {
        const { user } = render(
          <Teams initial={[ALPHA]} order={order} search />,
        );
        const { dialog, trigger } = await openDelete(user, 'Alpha');
        await confirmDelete(user, dialog, order, trigger);

        await waitFor(() => {
          expect(screen.getByText('No teams yet')).toBeInTheDocument();
          expect(
            screen.getByRole('button', { name: 'Create team' }),
          ).toHaveFocus();
        });
      });

      it("moves to the empty state's create action when the only row leaves", async () => {
        const { user } = render(<Teams initial={[ALPHA]} order={order} />);
        const { dialog, trigger } = await openDelete(user, 'Alpha');
        await confirmDelete(user, dialog, order, trigger);

        await waitFor(() => {
          expect(screen.getByText('No teams yet')).toBeInTheDocument();
          expect(
            screen.getByRole('button', { name: 'Create team' }),
          ).toHaveFocus();
        });
      });
    },
  );

  // #3715 is the cancel path and keeps its own assertion: nothing left the
  // list, so the dialog returns to the row's menu button.
  it("returns a cancelled delete to the row's menu button", async () => {
    const { user } = render(
      <Teams initial={[ALPHA, BETA]} order="after-close" />,
    );
    const { trigger, dialog } = await openDelete(user, 'Beta');
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('leaves the focus the reader moved elsewhere alone', async () => {
    const { user } = render(
      <>
        <Teams initial={[ALPHA, BETA]} order="after-close" />
        <button type="button">Elsewhere</button>
      </>,
    );
    const { dialog, trigger } = await openDelete(user, 'Beta');
    within(dialog).getByRole('button', { name: 'Delete' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(trigger).toHaveFocus());
    screen.getByRole('button', { name: 'Elsewhere' }).focus();

    await landRefetches();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  describe('when background restoration emits no bubbling focusin', () => {
    async function restoreWithoutFocusIn(
      user: ReturnType<typeof render>['user'],
    ) {
      const { dialog, trigger } = await openDelete(user, 'Alpha');
      let omitted = 0;
      const omitRestoredFocusIn = (event: FocusEvent) => {
        if (event.target === trigger) {
          omitted++;
          event.stopPropagation();
        }
      };
      // Chromium can update activeElement while its page is unfocused without
      // delivering focusin to the table. Keep the real focus and dialog close;
      // omit only that notification, after the opener was already captured.
      document.addEventListener('focusin', omitRestoredFocusIn, true);
      try {
        within(dialog).getByRole('button', { name: 'Delete' }).focus();
        await user.keyboard('{Enter}');
        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
          expect(trigger).toHaveFocus();
        });
        expect(omitted).toBeGreaterThan(0);
      } finally {
        document.removeEventListener('focusin', omitRestoredFocusIn, true);
      }
    }

    it.each([
      { initial: [ALPHA], successor: 'Create team' },
      { initial: [ALPHA, BETA], successor: 'Actions for Beta' },
    ])(
      'keeps focus on $successor after the refetch removes the restored row',
      async ({ initial, successor }) => {
        const { user } = render(
          <Teams initial={initial} order="after-close" />,
        );
        await restoreWithoutFocusIn(user);
        await landRefetches();

        await waitFor(() => {
          expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
          expect(screen.getByRole('button', { name: successor })).toHaveFocus();
        });
        await user.tab();
        expect(screen.getByRole('main')).toContainElement(
          document.activeElement as HTMLElement,
        );
      },
    );

    it.each([false, true])(
      'clears ownership when focus moves outside, even if that control is later blurred: %s',
      async (blurOutside) => {
        const { user } = render(
          <>
            <Teams initial={[ALPHA, BETA]} order="after-close" />
            <button type="button">Elsewhere</button>
          </>,
        );
        await restoreWithoutFocusIn(user);
        const outside = screen.getByRole('button', { name: 'Elsewhere' });
        outside.focus();
        if (blurOutside) outside.blur();
        await landRefetches();

        expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
        expect(document.activeElement).toBe(
          blurOutside ? document.body : outside,
        );
      },
    );
  });
});
