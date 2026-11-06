import '@testing-library/jest-dom/vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { act, cleanup, waitFor } from '@testing-library/react';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, within } from '@/tests/utils/render';

import { DeleteDialog } from '../dialog/delete-dialog';
import { Dialog } from '../dialog/dialog';
import { EntityRowActions } from '../entity/entity-row-actions';
import { DataTable } from './data-table';

import '../../globals.css';

// The table reads the org from the error scope for its error boundary; there
// is no provider under a component test.
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org_test' }),
}));

/**
 * The jsdom suite (`data-table-focus.test.tsx`) holds every order a confirmed
 * delete can take; this one holds what jsdom cannot show — the real Tab key,
 * Radix's focus trap, and `:focus-visible` — for the same three orders, on a
 * page and inside a modal (#3791):
 * - `with-row`: the list drops the row while its dialog is open, and the
 *   dialog, rendered in the row, goes with it;
 * - `after-close`: the dialog closes, focus goes back to the row's menu
 *   button, and the refetch drops the row a moment later;
 * - `disabled-then-removed`: as Teams does, the row disables its menu button
 *   as the dialog closes, and the refetch drops the row later.
 */
type Order = 'with-row' | 'after-close' | 'disabled-then-removed';
const ORDERS: readonly Order[] = [
  'with-row',
  'after-close',
  'disabled-then-removed',
];

interface Team {
  id: string;
  name: string;
}

const ALPHA = { id: 'alpha', name: 'Alpha' };
const BETA = { id: 'beta', name: 'Beta' };
const GAMMA = { id: 'gamma', name: 'Gamma' };

/** Refetches that have not landed yet (`after-close`): the test lands them. */
const pendingRefetches: Array<() => void> = [];

afterEach(() => {
  cleanup();
  pendingRefetches.length = 0;
});

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

function Teams({ initial, order }: { initial: Team[]; order: Order }) {
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
    <DataTable
      columns={columns}
      data={teams}
      getRowId={(team) => team.id}
      addAction={{ label: 'Create team', icon: Plus, onClick: vi.fn() }}
      emptyState={{ title: 'No teams yet' }}
    />
  );
}

/** A page with a skip link ahead of `<main>`, as the app shell has. */
function Page({ initial, order }: { initial: Team[]; order: Order }) {
  return (
    <>
      <a href="#main">Skip to main content</a>
      <main id="main" tabIndex={-1}>
        <Teams initial={initial} order={order} />
        <a href="#help">Help</a>
      </main>
    </>
  );
}

/** The same list in a modal, whose own delete confirmation opens over it. */
function ModalPage({ initial, order }: { initial: Team[]; order: Order }) {
  return (
    <Dialog open onOpenChange={() => undefined} title="Teams of the project">
      <Teams initial={initial} order={order} />
      <a href="#inside">Inside link</a>
    </Dialog>
  );
}

/** Opens a row's menu with the keyboard, chooses Delete, returns the dialog. */
async function openDelete(name: string) {
  const trigger = screen.getByRole('button', { name: `Actions for ${name}` });
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  const item = await screen.findByRole('menuitem', { name: 'Delete' });
  await waitFor(() => expect(item).toHaveFocus());
  await userEvent.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', { name: `Delete ${name}` });
  await waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return { trigger, dialog };
}

/** Confirms the open delete with the keyboard and lets the refetch land. */
async function confirmDelete(
  dialog: HTMLElement,
  order: Order,
  trigger: HTMLElement,
) {
  within(dialog).getByRole('button', { name: 'Delete' }).focus();
  await userEvent.keyboard('{Enter}');
  if (order === 'with-row') return;
  await waitFor(() => {
    expect(
      screen.queryByRole('dialog', { name: /^Delete / }),
    ).not.toBeInTheDocument();
    if (order === 'after-close') expect(trigger).toHaveFocus();
    // The disabled button cannot take the focus back; it never drops.
    else expect(document.activeElement).not.toBe(document.body);
  });
  await landRefetches();
}

describe('DataTable keeps the keyboard in the list after a confirmed delete, in real Chromium (#3791)', () => {
  describe.each(ORDERS)('on a page, when the row leaves %s', (order) => {
    it("lands on the next row's menu button, shown as keyboard focus, and Tab stays in the page's main", async () => {
      render(<Page initial={[ALPHA, BETA, GAMMA]} order={order} />);
      const { dialog, trigger } = await openDelete('Beta');
      await confirmDelete(dialog, order, trigger);

      await waitFor(() => {
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Actions for Gamma' }),
        ).toHaveFocus();
      });
      expect(document.activeElement?.matches(':focus-visible')).toBe(true);
      await userEvent.keyboard('{Tab}');
      expect(screen.getByRole('main')).toContainElement(
        document.activeElement as HTMLElement,
      );
    });

    it('lands on the row above when the last row of several leaves', async () => {
      render(<Page initial={[ALPHA, BETA]} order={order} />);
      const { dialog, trigger } = await openDelete('Beta');
      await confirmDelete(dialog, order, trigger);

      await waitFor(() => {
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Actions for Alpha' }),
        ).toHaveFocus();
      });
    });

    it('lands on the create action when the only row leaves', async () => {
      render(<Page initial={[ALPHA]} order={order} />);
      const { dialog, trigger } = await openDelete('Alpha');
      await confirmDelete(dialog, order, trigger);

      await waitFor(() => {
        expect(screen.getByText('No teams yet')).toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Create team' }),
        ).toHaveFocus();
      });
      expect(document.activeElement?.matches(':focus-visible')).toBe(true);
    });
  });

  describe.each(ORDERS)('in a modal, when the row leaves %s', (order) => {
    it('lands on the next row inside the modal, and Tab stays in it, never on its container', async () => {
      render(<ModalPage initial={[ALPHA, BETA, GAMMA]} order={order} />);
      const modal = await screen.findByRole('dialog', {
        name: 'Teams of the project',
      });
      const { dialog, trigger } = await openDelete('Beta');
      await confirmDelete(dialog, order, trigger);

      await waitFor(() => {
        expect(screen.queryByText('Beta')).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Actions for Gamma' }),
        ).toHaveFocus();
      });
      await userEvent.keyboard('{Tab}');
      expect(modal).toContainElement(document.activeElement as HTMLElement);
      expect(document.activeElement).not.toBe(modal);
    });
  });
});
