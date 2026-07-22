import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import enMessages from '../../../../messages/en.json';
import { ChatActions } from './chat-actions';

// ── Spies for the thread + project mutations the menu drives ────────────────
const {
  moveMutate,
  deleteMutate,
  archiveMutate,
  unarchiveMutate,
  pinMutate,
  projectsState,
  createDialog,
} = vi.hoisted(() => ({
  moveMutate: vi.fn(),
  deleteMutate: vi.fn(),
  archiveMutate: vi.fn(),
  unarchiveMutate: vi.fn(),
  pinMutate: vi.fn(),
  projectsState: {
    projects: [
      { _id: 'p1', name: 'Investing', icon: 'DollarSign', color: 'green' },
      { _id: 'p2', name: 'Business', icon: 'Folder', color: 'gray' },
      { _id: 'p3', name: 'Homework', icon: 'GraduationCap', color: 'blue' },
    ] as Array<{ _id: string; name: string; icon: string; color: string }>,
  },
  createDialog: { onCreated: null as ((id: string) => void) | null },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteThread: () => ({ mutate: deleteMutate, isPending: false }),
  useArchiveThread: () => ({ mutate: archiveMutate }),
  useUnarchiveThread: () => ({ mutate: unarchiveMutate }),
  useSetThreadPinned: () => ({ mutate: pinMutate }),
}));

vi.mock('@/app/features/projects/hooks/mutations', () => ({
  useMoveThreadToProject: () => ({ mutate: moveMutate }),
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => projectsState,
}));

vi.mock('@/app/features/settings/governance/hooks/queries', () => ({
  useLegalHoldByTarget: () => ({ data: null }),
}));

// The create-project dialog pulls in a form + Convex; stub it to a marker and
// capture its `onCreated` so we can assert the "create → move" hand-off.
vi.mock('@/app/features/projects/components/project-create-dialog', () => ({
  ProjectCreateDialog: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated?: (id: string) => void;
  }) => {
    createDialog.onCreated = onCreated ?? null;
    return open ? <div data-testid="create-project-dialog" /> : null;
  },
}));

// Delete confirmation → a plain confirm button while open.
vi.mock('@/app/components/ui/dialog/delete-dialog', () => ({
  DeleteDialog: ({ open, onDelete }: { open: boolean; onDelete: () => void }) =>
    open ? (
      <button type="button" onClick={onDelete}>
        confirm-delete
      </button>
    ) : null,
}));

// Stand in for the Radix dropdown (portals are flaky in jsdom): the trigger
// plus one button per action item; a `sub` entry renders its label as a marker
// span and its nested items inline, so the Move-to-project submenu is drivable.
interface MenuItemStub {
  type: string;
  label: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
  items?: MenuItemStub[][];
}
function StubMenuItems({ items }: { items: MenuItemStub[] }) {
  return (
    <>
      {items.map((item, i) => {
        if (item.type === 'item') {
          return (
            // oxlint-disable-next-line react/no-array-index-key
            <button
              key={i}
              type="button"
              disabled={item.disabled}
              data-selected={item.selected ? 'true' : undefined}
              onClick={item.onClick}
            >
              {item.label}
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
        if (item.type === 'label') {
          // oxlint-disable-next-line react/no-array-index-key
          return <span key={i}>{item.content}</span>;
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

const CHAT = { id: 'chat-1', title: 'Quarterly plan' };

function renderActions(props?: Partial<Parameters<typeof ChatActions>[0]>) {
  return render(
    <ChatActions
      chat={CHAT}
      organizationId="org-1"
      currentChatId="chat-1"
      projectId="p2"
      {...props}
    />,
  );
}

describe('ChatActions — Move to project', () => {
  beforeEach(() => {
    moveMutate.mockClear();
    deleteMutate.mockClear();
    pinMutate.mockClear();
    createDialog.onCreated = null;
  });

  // "Move to project" drills down in place; open it before asserting the list.
  async function openMoveView(user: ReturnType<typeof renderActions>['user']) {
    await user.click(screen.getByText(enMessages.projects.picker.title));
  }

  it('lists every project after opening "Move to project"', async () => {
    const { user } = renderActions();
    // Not shown until the drill-down is opened (no lateral flyout).
    expect(screen.queryByText('Homework')).not.toBeInTheDocument();
    await openMoveView(user);
    expect(screen.getByText('Investing')).toBeInTheDocument();
    expect(screen.getByText('Business')).toBeInTheDocument();
    expect(screen.getByText('Homework')).toBeInTheDocument();
  });

  it('disables the current project (you cannot move a chat onto itself)', async () => {
    const { user } = renderActions({ projectId: 'p2' });
    await openMoveView(user);
    // p2 = Business is the current project.
    expect(screen.getByText('Business').closest('button')).toBeDisabled();
    expect(screen.getByText('Investing').closest('button')).toBeEnabled();
  });

  it('moves the chat when a project row is chosen', async () => {
    const { user } = renderActions({ projectId: 'p2' });
    await openMoveView(user);
    // Click the row's label; the event bubbles to the (enabled) row button.
    await user.click(screen.getByText('Homework'));
    expect(moveMutate).toHaveBeenCalledWith(
      { threadId: 'chat-1', projectId: 'p3' },
      expect.anything(),
    );
  });

  it('opens the create dialog from "New project" and moves on creation', async () => {
    const { user } = renderActions();
    await openMoveView(user);
    await user.click(screen.getByText(enMessages.chat.newProject));
    expect(screen.getByTestId('create-project-dialog')).toBeInTheDocument();

    // The dialog reports the new id; the menu moves the chat into it.
    createDialog.onCreated?.('p-new');
    expect(moveMutate).toHaveBeenCalledWith(
      { threadId: 'chat-1', projectId: 'p-new' },
      expect.anything(),
    );
  });

  it('removes the chat from its project (projectId: null)', async () => {
    const { user } = renderActions({ projectId: 'p2' });
    await openMoveView(user);
    await user.click(screen.getByText(enMessages.chat.removeFromProject));
    expect(moveMutate).toHaveBeenCalledWith(
      { threadId: 'chat-1', projectId: null },
      expect.anything(),
    );
  });

  it('offers "New project" with an empty-state note when there are no projects', async () => {
    projectsState.projects = [];
    try {
      const { user } = renderActions({ projectId: undefined });
      await openMoveView(user);
      expect(screen.getByText(enMessages.chat.newProject)).toBeInTheDocument();
      expect(
        screen.getByText(enMessages.projects.picker.empty),
      ).toBeInTheDocument();
    } finally {
      projectsState.projects = [
        { _id: 'p1', name: 'Investing', icon: 'DollarSign', color: 'green' },
        { _id: 'p2', name: 'Business', icon: 'Folder', color: 'gray' },
        { _id: 'p3', name: 'Homework', icon: 'GraduationCap', color: 'blue' },
      ];
    }
  });

  it('hides "Remove from project" when the chat is not in a project', async () => {
    const { user } = renderActions({ projectId: undefined });
    await openMoveView(user);
    expect(
      screen.queryByText(enMessages.chat.removeFromProject),
    ).not.toBeInTheDocument();
  });

  it('deletes via the confirmation dialog', async () => {
    const { user } = renderActions();
    await user.click(screen.getByText(enMessages.common.actions.delete));
    await user.click(screen.getByText('confirm-delete'));
    expect(deleteMutate).toHaveBeenCalledWith(
      { threadId: 'chat-1' },
      expect.anything(),
    );
  });
});
