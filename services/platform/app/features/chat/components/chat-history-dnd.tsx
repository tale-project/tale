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
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { useMoveThreadToProject } from '@/app/features/projects/hooks/mutations';
import type { Id } from '@/convex/_generated/dataModel';
import { cn } from '@/lib/utils/cn';

const NO_PROJECT_DROPPABLE_ID = 'project:none';

/** Payload a chat row advertises while it is being dragged. */
export interface ChatDragData {
  type: 'chat';
  /** The project the chat currently belongs to (`null` = none). */
  projectId: string | null;
  title: string;
}

/** Payload a drop target advertises (`null` projectId = the "no project" zone). */
interface ChatDropData {
  projectId: Id<'projects'> | null;
}

/**
 * dnd-kit types `data.current` as `Record<string, any>`, so these readers
 * validate the shape once and hand the rest of the module fully-typed values
 * (no scattered casts, no trusting an arbitrary drag source).
 */
function readDragData(
  data: Record<string, unknown> | undefined,
): ChatDragData | null {
  if (data?.type !== 'chat' || typeof data.title !== 'string') return null;
  return {
    type: 'chat',
    title: data.title,
    projectId: typeof data.projectId === 'string' ? data.projectId : null,
  };
}

function readDropData(
  data: Record<string, unknown> | undefined,
): ChatDropData | null {
  if (!data || !('projectId' in data)) return null;
  // The id was put here by `useProjectDropZone` from a real `Id<'projects'>`;
  // dnd-kit just widens `data.current` to `any` on the way through.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- round-trips through dnd-kit's untyped data store; origin is a validated project id
  const projectId = data.projectId as Id<'projects'> | undefined;
  return { projectId: typeof projectId === 'string' ? projectId : null };
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

interface ActiveChat {
  id: string;
  title: string;
}

const ChatDndStateContext = createContext<{ isDragging: boolean }>({
  isDragging: false,
});

/** True while a chat row is being dragged anywhere in the tree. */
export function useChatDndState() {
  return useContext(ChatDndStateContext);
}

/**
 * Owns all chat drag-and-drop wiring: sensors, collision/measuring strategy,
 * the lifted-row overlay, and committing the move. Wrap the draggable tree in
 * this; rows opt in with {@link useChatDraggable} and zones with
 * {@link useProjectDropZone}.
 */
export function ChatDndProvider({ children }: { children: ReactNode }) {
  const { mutate: moveThreadToProject } = useMoveThreadToProject();
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);

  const sensors = useSensors(
    // Mouse: start dragging after a small move so plain clicks still open a chat.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // Touch: press-and-hold to drag, so a vertical swipe scrolls the list
    // (this sidebar also lives inside a full-height mobile Sheet).
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const drag = readDragData(event.active.data.current);
    setActiveChat(
      drag ? { id: String(event.active.id), title: drag.title } : null,
    );
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveChat(null);
      const drag = readDragData(event.active.data.current);
      const drop = readDropData(event.over?.data.current);
      if (!drag || !drop || drag.projectId === drop.projectId) return;
      moveThreadToProject({
        threadId: String(event.active.id),
        projectId: drop.projectId,
      });
    },
    [moveThreadToProject],
  );

  const handleDragCancel = useCallback(() => setActiveChat(null), []);

  const state = useMemo(
    () => ({ isDragging: activeChat !== null }),
    [activeChat],
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
      <ChatDndStateContext.Provider value={state}>
        {children}
      </ChatDndStateContext.Provider>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeChat ? <ChatDragPreview title={activeChat.title} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** The lifted card that follows the cursor during a drag. */
function ChatDragPreview({ title }: { title: string }) {
  return (
    <div className="bg-accent text-accent-foreground ring-border flex max-w-[15rem] cursor-grabbing items-center gap-2 rounded-md px-2 py-1.5 text-sm shadow-lg ring-1">
      <span className="truncate">{title}</span>
    </div>
  );
}

/** Make a chat row draggable, carrying its current project as the drag payload. */
export function useChatDraggable(chat: {
  id: string;
  projectId: string | null;
  title: string;
  disabled: boolean;
}) {
  const data: ChatDragData = {
    type: 'chat',
    projectId: chat.projectId,
    title: chat.title,
  };
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: chat.id,
    data,
    disabled: chat.disabled,
  });
  return { setNodeRef, listeners, isDragging };
}

/** Register a project folder (or the "no project" zone, when `projectId` is null) as a drop target. */
export function useProjectDropZone(projectId: Id<'projects'> | null) {
  const data: ChatDropData = { projectId };
  const { setNodeRef, isOver } = useDroppable({
    id: projectId ? `project:${projectId}` : NO_PROJECT_DROPPABLE_ID,
    data,
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
