// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { DndContext } from '@dnd-kit/core';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Board, composeMoveArgs, type BoardProps } from './board';
import { BoardCard } from './board-card';

// i18n → echo `<ns>.<key>` (collection.test.tsx convention) so assertions read
// clearly without locale fixtures.
vi.mock('@tale/ui/i18n/locale-provider', () => ({
  useLocale: () => ({ locale: 'en' }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) =>
      params
        ? Object.entries(params).reduce(
            (acc, [k, v]) => acc.replace(`{${k}}`, v),
            `${ns}.${key}`,
          )
        : `${ns}.${key}`,
  }),
}));

// The bound read — driven by hand per test.
let queryReturn: {
  data: unknown;
  isLoading: boolean;
  error: unknown;
  blocked: boolean;
  needsConfig: boolean;
};
vi.mock('../../hooks/use-bound-query', () => ({
  useBoundQuery: () => queryReturn,
}));

// The bound write — capture the binding and every dispatch.
const dispatch = vi.fn(() => Promise.resolve({ ok: true }));
const boundActionCalls: Array<{ path: string; mode: string }> = [];
vi.mock('../../hooks/use-bound-action', () => ({
  useBoundAction: (path: string, mode: string) => {
    boundActionCalls.push({ path, mode });
    return { dispatch, isPending: false };
  },
}));

const applyEffect = vi.fn();
vi.mock('../../runtime/action-effects', () => ({
  useActionEffect: () => applyEffect,
}));

// Ambient run chip — assert wiring, not its own reactive internals.
vi.mock('./subject-run-status-chip', () => ({
  SubjectRunStatusChip: ({
    subjectType,
    subjectId,
    fallback,
  }: {
    subjectType: string;
    subjectId: string;
    fallback: ReactNode;
  }) => (
    <span data-testid={`chip:${subjectType}:${subjectId}`}>{fallback}</span>
  ),
}));

// Stand in for the Radix dropdown (portals are flaky in jsdom): the trigger
// plus one button per action item — a `sub` entry renders its label as a
// marker span and its nested items inline — so the menu flow (including the
// Move-to submenu) can be driven directly.
interface MenuItemStub {
  type: string;
  label: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  items?: MenuItemStub[][];
}
function StubMenuItems({ items }: { items: MenuItemStub[] }) {
  return (
    <>
      {items.map((item, i) => {
        if (item.type === 'item') {
          return (
            <button
              // Positional stub — the index is the identity here.
              // oxlint-disable-next-line react/no-array-index-key
              key={i}
              type="button"
              disabled={item.disabled}
              onClick={item.onClick}
            >
              {`menu:${typeof item.label === 'string' ? item.label : ''}`}
            </button>
          );
        }
        if (item.type === 'sub') {
          return (
            // oxlint-disable-next-line react/no-array-index-key
            <div key={i}>
              <span>
                {`sub:${typeof item.label === 'string' ? item.label : ''}`}
              </span>
              <StubMenuItems items={(item.items ?? []).flat()} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
}
vi.mock('@tale/ui/dropdown-menu', () => ({
  DropdownMenu: ({
    trigger,
    items,
  }: {
    trigger: ReactNode;
    items: MenuItemStub[][];
  }) => (
    <div>
      {trigger}
      <StubMenuItems items={items.flat()} />
    </div>
  ),
}));

// House confirm dialog → a plain confirm button while open.
vi.mock('@/app/components/ui/dialog/confirm-dialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    title,
  }: {
    open?: boolean;
    onConfirm: () => void;
    title: string;
  }) =>
    open ? (
      <div>
        <span>{title}</span>
        <button type="button" onClick={onConfirm}>
          confirm-dialog-confirm
        </button>
      </div>
    ) : null,
}));

const ROWS = [
  { _id: 't1', title: 'Fix login', status: 'todo', priority: 'high' },
  { _id: 't2', title: 'Ship board', status: 'doing', priority: 'low' },
  { _id: 't3', title: 'Lost card', status: 'someday', priority: 'low' },
];

function loaded(data: unknown) {
  return {
    data,
    isLoading: false,
    error: undefined,
    blocked: false,
    needsConfig: false,
  };
}

function props(over: Partial<BoardProps> = {}): BoardProps {
  return {
    query: { path: 'tasks/queries:listTasksByProject', args: {} },
    itemsKey: 'tasks',
    groupBy: 'status',
    lanes: [
      { value: 'todo', labelKey: 'Todo' },
      { value: 'doing', labelKey: 'Doing' },
    ],
    card: { titleField: 'title', badgeField: 'priority' },
    move: {
      path: 'tasks/mutations:moveTask',
      mode: 'mutation',
      args: { taskId: '$selected._id', status: '$lane' },
    },
    ...over,
  };
}

afterEach(() => {
  dispatch.mockClear();
  applyEffect.mockClear();
  boundActionCalls.length = 0;
});

describe('Board — lanes and cards', () => {
  it('renders declared lanes in order with their literal labels, counts, and field-mapped cards', () => {
    queryReturn = loaded({ tasks: ROWS, truncated: false });

    const { container } = render(<Board {...props()} />);

    // The BlockFrame's own Section is a <section> too — lanes are nested.
    const laneSections = [...container.querySelectorAll('section section')];
    expect(laneSections).toHaveLength(2);
    expect(laneSections[0]).toHaveTextContent('Todo');
    expect(laneSections[0]).toHaveTextContent('1'); // lane count
    expect(laneSections[0]).toHaveTextContent('Fix login');
    expect(laneSections[0]).toHaveTextContent('high'); // badge field
    expect(laneSections[1]).toHaveTextContent('Doing');
    expect(laneSections[1]).toHaveTextContent('Ship board');
    // The move binding is bound once, to the declared path/mode.
    expect(boundActionCalls).toContainEqual({
      path: 'tasks/mutations:moveTask',
      mode: 'mutation',
    });
  });

  it('hides rows whose groupBy value matches no declared lane and counts them in the header note', () => {
    queryReturn = loaded({ tasks: ROWS, truncated: false });

    render(<Board {...props()} />);

    expect(screen.queryByText('Lost card')).not.toBeInTheDocument();
    expect(
      screen.getByText(/automations\.board\.hiddenCards/),
    ).toBeInTheDocument();
  });

  it('surfaces a truncation notice when the result carries truncated: true', () => {
    queryReturn = loaded({ tasks: ROWS.slice(0, 2), truncated: true });

    render(<Board {...props()} />);

    expect(
      screen.getByText(/automations\.board\.truncated/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/automations\.board\.hiddenCards/),
    ).not.toBeInTheDocument();
  });

  it('reads a bare array result when itemsKey is unset', () => {
    queryReturn = loaded(ROWS.slice(0, 2));

    render(<Board {...props({ itemsKey: undefined })} />);

    expect(screen.getByText('Fix login')).toBeInTheDocument();
    expect(screen.getByText('Ship board')).toBeInTheDocument();
  });

  it('renders subtitle and meta fields when mapped', () => {
    queryReturn = loaded({
      tasks: [
        {
          _id: 't1',
          title: 'Fix login',
          status: 'todo',
          number: 12,
          kind: 'bug',
        },
      ],
    });

    render(
      <Board
        {...props({
          card: {
            titleField: 'title',
            subtitleField: 'kind',
            metaFields: ['number'],
          },
        })}
      />,
    );

    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('swaps the badge slot for the subject run-status chip when subjectType is set', () => {
    queryReturn = loaded({ tasks: [ROWS[0]] });

    render(<Board {...props({ subjectType: 'task' })} />);

    const chip = screen.getByTestId('chip:task:t1');
    expect(chip).toHaveTextContent('high'); // badge is the chip's fallback
  });
});

describe('Board — binding states', () => {
  it('shows the standard empty state when the query returns no rows', () => {
    queryReturn = loaded({ tasks: [] });

    render(<Board {...props()} />);

    expect(screen.getByText('automations.binding.empty')).toBeInTheDocument();
  });

  it('surfaces the blocked state when the path is not allowlisted', () => {
    queryReturn = { ...loaded(undefined), blocked: true };

    render(<Board {...props()} />);

    expect(
      screen.getByText(/automations\.binding\.blocked/),
    ).toBeInTheDocument();
  });

  it('prompts to configure when a binding is unresolved', () => {
    queryReturn = { ...loaded(undefined), needsConfig: true };

    render(<Board {...props()} />);

    expect(
      screen.getByText('automations.list.needsConfig'),
    ).toBeInTheDocument();
  });

  it('shows a skeleton (not a premature empty state) while loading', () => {
    queryReturn = { ...loaded(undefined), isLoading: true };

    render(<Board {...props()} />);

    expect(
      screen.queryByText('automations.binding.empty'),
    ).not.toBeInTheDocument();
  });
});

describe('Board — card activation', () => {
  const onCardClick = {
    kind: 'openDetail',
    subjectType: 'task',
    id: '$selected._id',
  } as const;

  it('applies the onCardClick effect with the clicked row', async () => {
    queryReturn = loaded({ tasks: [ROWS[0]] });

    render(<Board {...props({ onCardClick })} />);
    await userEvent.click(screen.getByText('Fix login'));

    expect(applyEffect).toHaveBeenCalledWith(onCardClick, undefined, ROWS[0]);
  });

  it('activates on Enter on the card itself', () => {
    queryReturn = loaded({ tasks: [ROWS[0]] });

    render(<Board {...props({ onCardClick })} />);
    const card = screen.getByText('Fix login').closest('[role="button"]');
    expect(card).not.toBeNull();
    if (!card) return;
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(applyEffect).toHaveBeenCalledWith(onCardClick, undefined, ROWS[0]);
  });
});

describe('Board — card actions', () => {
  const startAction = {
    labelKey: 'list.start',
    path: 'tasks/mutations:startTask',
    mode: 'mutation',
    args: { taskId: '$selected._id' },
    when: 'status == todo',
    onSuccess: { kind: 'toast', titleKey: 'started' },
  } as const;

  it('hides actions whose when predicate fails the row (the menu keeps only Move to)', () => {
    queryReturn = loaded({ tasks: [ROWS[1]] }); // status: doing

    render(<Board {...props({ actions: [startAction] })} />);

    expect(
      screen.queryByRole('button', { name: 'menu:automations.list.start' }),
    ).not.toBeInTheDocument();
    // The overflow menu itself stays — it carries the keyboard Move-to path.
    expect(
      screen.getByRole('button', { name: 'common.actions.openMenu' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('sub:automations.board.moveTo'),
    ).toBeInTheDocument();
  });

  it('dispatches a menu action against the row and applies its onSuccess effect', async () => {
    queryReturn = loaded({ tasks: [ROWS[0]] }); // status: todo

    render(<Board {...props({ actions: [startAction] })} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'menu:automations.list.start' }),
    );

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(startAction.args, ROWS[0]);
      expect(applyEffect).toHaveBeenCalledWith(
        startAction.onSuccess,
        { ok: true },
        ROWS[0],
      );
    });
  });

  it('routes a confirm action through the confirm dialog before dispatching', async () => {
    queryReturn = loaded({ tasks: [ROWS[0]] });
    const confirmAction = { ...startAction, confirm: true };

    render(<Board {...props({ actions: [confirmAction] })} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'menu:automations.list.start' }),
    );
    expect(dispatch).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: 'confirm-dialog-confirm' }),
    );
    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(confirmAction.args, ROWS[0]);
    });
  });
});

describe('Board — keyboard move (the Move-to submenu)', () => {
  /** The card element scoping a per-card menu query (dnd-kit injects the
   *  role at runtime). */
  function cardOf(title: string): HTMLElement {
    const card = screen.getByText(title).closest('[role="button"]');
    expect(card).not.toBeNull();
    return card as HTMLElement;
  }

  it('lists every OTHER lane by its literal label (never the card’s own lane)', () => {
    queryReturn = loaded({ tasks: ROWS.slice(0, 2) }); // t1 todo, t2 doing

    render(<Board {...props()} />);

    const todoCard = within(cardOf('Fix login'));
    expect(
      todoCard.getByText('sub:automations.board.moveTo'),
    ).toBeInTheDocument();
    expect(
      todoCard.getByRole('button', { name: 'menu:Doing' }),
    ).toBeInTheDocument();
    expect(
      todoCard.queryByRole('button', { name: 'menu:Todo' }),
    ).not.toBeInTheDocument();

    // The doing-lane card offers the inverse target.
    const doingCard = within(cardOf('Ship board'));
    expect(
      doingCard.getByRole('button', { name: 'menu:Todo' }),
    ).toBeInTheDocument();
    expect(
      doingCard.queryByRole('button', { name: 'menu:Doing' }),
    ).not.toBeInTheDocument();
  });

  it('dispatches the same move as a drop onto the END of the target lane', async () => {
    queryReturn = loaded({ tasks: ROWS.slice(0, 2) }); // t2 is last in doing

    render(<Board {...props()} />);
    await userEvent.click(
      within(cardOf('Fix login')).getByRole('button', { name: 'menu:Doing' }),
    );

    // Appending to the lane end: the previously-last card (t2) comes BEFORE
    // the moved one, nothing after — exactly the end-of-lane drop contract.
    expect(dispatch).toHaveBeenCalledWith(
      {
        taskId: '$selected._id',
        status: '$lane',
        beforeTaskId: 't2',
        afterTaskId: undefined,
      },
      ROWS[0],
      { lane: 'doing' },
    );
  });

  it('activates a move target with the keyboard (Enter on the menu item)', async () => {
    queryReturn = loaded({ tasks: [ROWS[0]] }); // doing lane is empty

    render(<Board {...props()} />);
    const target = screen.getByRole('button', { name: 'menu:Doing' });
    target.focus();
    await userEvent.keyboard('{Enter}');

    expect(dispatch).toHaveBeenCalledWith(
      {
        taskId: '$selected._id',
        status: '$lane',
        beforeTaskId: undefined,
        afterTaskId: undefined,
      },
      ROWS[0],
      { lane: 'doing' },
    );
  });

  it('renders no Move-to section on a card without a move binding', () => {
    // The Board always wires `moveTo` (its `move` binding is required); the
    // card owns the conditional — no `moveTo`, no Move-to section.
    render(
      <DndContext>
        <BoardCard
          row={ROWS[0]}
          rowId="t1"
          card={{ titleField: 'title' }}
          actions={[
            {
              labelKey: 'list.start',
              path: 'tasks/mutations:startTask',
              mode: 'mutation',
            },
          ]}
        />
      </DndContext>,
    );

    expect(
      screen.getByRole('button', { name: 'menu:automations.list.start' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^sub:/)).not.toBeInTheDocument();
  });
});

describe('composeMoveArgs — the move-args contract', () => {
  it('merges computed neighbour ids after the authored args', () => {
    expect(
      composeMoveArgs(
        { taskId: '$selected._id', status: '$lane' },
        'before-1',
        'after-1',
      ),
    ).toEqual({
      taskId: '$selected._id',
      status: '$lane',
      beforeTaskId: 'before-1',
      afterTaskId: 'after-1',
    });
  });

  it('always writes the computed keys — an authored clash loses, an edge drop yields undefined (omitted on the wire)', () => {
    expect(
      composeMoveArgs(
        { taskId: '$selected._id', beforeTaskId: '$state.stale' },
        undefined,
        'after-1',
      ),
    ).toEqual({
      taskId: '$selected._id',
      beforeTaskId: undefined,
      afterTaskId: 'after-1',
    });
  });

  it('tolerates a non-record authored args value', () => {
    expect(composeMoveArgs(undefined, 'b', undefined)).toEqual({
      beforeTaskId: 'b',
      afterTaskId: undefined,
    });
  });
});
