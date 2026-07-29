'use client';

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  defaultDropAnimationSideEffects,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type MeasuringConfiguration,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Row } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useThreadProjectMove } from '../data/chat-backend';
import { useThreadActions } from '../data/thread-actions';
import { useThreadListFrame } from './thread-list-context';

const NO_PROJECT_DROPPABLE_ID = 'project:none';
const ARCHIVE_DROPPABLE_ID = 'archive';

/** Payload a chat row advertises while it is being dragged. */
export interface ThreadDragData {
  /** Dragging out of the ARCHIVED drawer unarchives on drop. */
  archived?: boolean;
  type: 'thread';
  /** The project the thread currently belongs to (`null` = none). */
  projectId: string | null;
  title: string;
}

/** Payload a drop target advertises: a project folder (`null` projectId = the
 * "no project" zone), or the ARCHIVED drawer, where a drop archives the chat. */
type ThreadDropData =
  | { kind: 'project'; projectId: string | null }
  | { kind: 'archive' };

/**
 * dnd-kit types `data.current` as `Record<string, any>`, so these readers
 * validate the shape once and hand the rest of the module fully-typed values
 * (no scattered casts, no trusting an arbitrary drag source).
 */
function readDragData(
  data: Record<string, unknown> | undefined,
): ThreadDragData | null {
  if (data?.type !== 'thread' || typeof data.title !== 'string') return null;
  return {
    type: 'thread',
    title: data.title,
    projectId: typeof data.projectId === 'string' ? data.projectId : null,
    // Carried through so a drag OUT of the archived drawer can revive the
    // chat — the reader rebuilds field by field, so anything omitted here is
    // silently lost.
    archived: data.archived === true,
  };
}

function readDropData(
  data: Record<string, unknown> | undefined,
): ThreadDropData | null {
  if (data?.kind === 'archive') return { kind: 'archive' };
  if (data?.kind === 'project' && 'projectId' in data) {
    return {
      kind: 'project',
      projectId: typeof data.projectId === 'string' ? data.projectId : null,
    };
  }
  return null;
}

// Pointer-first collision: drop into whatever zone sits under the cursor, which
// reads far more predictably than "closest center" when folders vary wildly in
// height. Fall back to rect-intersection for the gaps between zones so a drop
// near an edge still lands somewhere sensible.
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0
    ? pointerCollisions
    : rectIntersection(args);
};

// Folders expand/collapse and the empty-folder placeholders appear mid-drag, so
// re-measure drop targets continuously instead of only at drag start.
const measuring: MeasuringConfiguration = {
  droppable: { strategy: MeasuringStrategy.Always },
};

// On drop, fade the lifted row out where it was released (with a subtle
// settle-scale) instead of letting dnd-kit fly it back to its origin — the row
// re-appears in its new folder via the reactive query update. The source row is
// held hidden for the duration so it doesn't flicker back in before that lands.
const dropAnimation: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  keyframes: ({ transform }) => [
    { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
    {
      opacity: 0,
      transform: CSS.Transform.toString({
        ...transform.initial,
        scaleX: 0.96,
        scaleY: 0.96,
      }),
    },
  ],
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0' } },
  }),
};

interface ActiveThread {
  id: string;
  title: string;
  /** The dragged row came from the ARCHIVED drawer. */
  archived: boolean;
}

const ThreadDndStateContext = createContext<{
  isDragging: boolean;
  /** True while the row being dragged is an archived one. */
  activeIsArchived: boolean;
}>({
  isDragging: false,
  activeIsArchived: false,
});

/** True while a chat row is being dragged anywhere in the tree. */
export function useThreadDndState() {
  return useContext(ThreadDndStateContext);
}

/**
 * Owns all chat drag-and-drop wiring: sensors, collision/measuring strategy,
 * the lifted-row overlay, and committing the move through the chat seam. Wrap
 * the draggable tree in this; rows opt in with {@link useThreadDraggable} and
 * zones with {@link useProjectDropZone}.
 */
export function ThreadDndProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const { t } = useT('chat');
  const { move } = useThreadProjectMove(organizationId);
  const actions = useThreadActions(organizationId);
  const { activeThreadId } = useThreadListFrame();
  const navigate = useNavigate();
  const [activeThread, setActiveThread] = useState<ActiveThread | null>(null);

  const sensors = useSensors(
    // Mouse: start dragging after a small move so plain clicks still open a chat.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: press-and-hold to drag, so a vertical swipe scrolls the list.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const drag = readDragData(event.active.data.current);
    setActiveThread(
      drag
        ? {
            id: String(event.active.id),
            title: drag.title,
            archived: drag.archived === true,
          }
        : null,
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveThread(null);
      const drag = readDragData(event.active.data.current);
      const drop = readDropData(event.over?.data.current);
      if (!drag || !drop) return;
      const threadId = String(event.active.id);
      // Dropping onto the ARCHIVED drawer files the chat away — the drag
      // counterpart of the row menu's Archive action, same toasts and same
      // leave-the-conversation behaviour when the open chat is archived.
      if (drop.kind === 'archive') {
        if (drag.archived === true) return;
        void actions.setArchived(threadId, true).then((ok: boolean) => {
          if (!ok) {
            toast({ title: t('archiveFailed'), variant: 'destructive' });
            return;
          }
          toast({ title: t('archiveSuccess') });
          if (threadId === activeThreadId) {
            void navigate({
              to: '/dashboard/$id/chat',
              params: { id: organizationId },
            });
          }
        });
        return;
      }
      const rehomes = drag.projectId !== drop.projectId;
      // Dragging an archived chat anywhere out of the drawer means "bring it
      // back": unarchive first, so the row actually appears where it was
      // dropped instead of silently staying filed under ARCHIVED.
      const revives = drag.archived === true;
      if (!rehomes && !revives) return;
      const restore = revives
        ? actions.setArchived(threadId, false).then((ok: boolean) => {
            if (!ok) throw new Error('unarchive refused');
          })
        : Promise.resolve();
      restore
        .then(() => (rehomes ? move(threadId, drop.projectId) : undefined))
        .catch((error: unknown) => {
          console.error('[chat] could not move the thread', error);
          toast({
            title: t('history.toast.moveFailed'),
            variant: 'destructive',
          });
        });
    },
    [actions, activeThreadId, move, navigate, organizationId, t],
  );

  const handleDragCancel = useCallback(() => setActiveThread(null), []);

  const state = useMemo(
    () => ({
      isDragging: activeThread !== null,
      activeIsArchived: activeThread?.archived === true,
    }),
    [activeThread],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={measuring}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <ThreadDndStateContext.Provider value={state}>
        {children}
      </ThreadDndStateContext.Provider>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeThread ? <ThreadDragPreview title={activeThread.title} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The lifted card that follows the cursor during a drag. Deliberately styled
 * as an elevated popover-surface card (not the muted fill used for the active
 * row) with a slight tilt + strong shadow, so a dragged chat never looks like
 * the currently-selected chat.
 */
function ThreadDragPreview({ title }: { title: string }) {
  return (
    <Row
      gap={2}
      className="bg-popover text-popover-foreground border-border max-w-[15rem] rotate-2 cursor-grabbing rounded-md border px-2 py-1.5 text-sm shadow-xl"
    >
      <span className="truncate">{title}</span>
    </Row>
  );
}

/** Make a chat row draggable, carrying its current project as the drag payload. */
export function useThreadDraggable(thread: {
  id: string;
  projectId: string | null;
  title: string;
  archived?: boolean;
}) {
  const data: ThreadDragData = {
    type: 'thread',
    projectId: thread.projectId,
    title: thread.title,
    ...(thread.archived === true ? { archived: true } : {}),
  };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: thread.id,
    data,
  });
  return { setNodeRef, listeners, isDragging };
}

/** Register a project folder (or the "no project" zone, when `projectId` is null) as a drop target. */
export function useProjectDropZone(projectId: string | null) {
  const data: ThreadDropData = { kind: 'project', projectId };
  const { setNodeRef, isOver } = useDroppable({
    id: projectId ? `project:${projectId}` : NO_PROJECT_DROPPABLE_ID,
    data,
  });
  return { setNodeRef, isOver };
}

/**
 * Register the ARCHIVED drawer as a drop target — dropping a chat on it
 * archives the chat. Disabled while the dragged row is itself an archived one
 * (dropping it back where it came from would be a no-op, so the zone should
 * not light up as if it did something).
 */
export function useArchiveDropZone() {
  const { activeIsArchived } = useThreadDndState();
  const data: ThreadDropData = { kind: 'archive' };
  const { setNodeRef, isOver } = useDroppable({
    id: ARCHIVE_DROPPABLE_ID,
    data,
    disabled: activeIsArchived,
  });
  return { setNodeRef, isOver };
}

/** Shared drop-target container styling — a soft fill + ring while hovered. */
export function dropZoneClassName(highlighted: boolean) {
  return cn(
    'rounded-md transition-colors',
    highlighted && 'bg-accent/40 ring-primary ring-1 ring-inset',
  );
}
