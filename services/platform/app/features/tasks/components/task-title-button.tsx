import type { useSortable } from '@dnd-kit/sortable';
import { cn } from '@tale/ui/cn';

/**
 * The board and list share one open target and keyboard drag activator.
 * Its stretched hit area belongs to a relative card/row; sibling controls
 * sit above it with `relative z-10`, never inside the title button.
 */
export function TaskTitleButton({
  title,
  sortable,
  draggable,
  onOpen,
  className,
}: {
  title: string;
  sortable: Pick<
    ReturnType<typeof useSortable>,
    'setActivatorNodeRef' | 'attributes' | 'listeners'
  >;
  draggable: boolean;
  onOpen: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      ref={sortable.setActivatorNodeRef}
      {...(draggable ? sortable.attributes : {})}
      {...(draggable ? sortable.listeners : {})}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        // Enter opens; Space picks up/drops a draggable task. A nested,
        // archived or read-only task opens with either key.
        if (e.key === 'Enter' || (e.key === ' ' && !draggable)) {
          e.preventDefault();
          onOpen();
          return;
        }
        if (draggable) sortable.listeners?.onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        // Firefox also clicks a native button on Space keyup after a
        // prevented keydown. Opening or dragging already happened above.
        if (e.key === ' ') e.preventDefault();
      }}
      className={cn(
        'focus-visible:outline-none',
        "after:absolute after:inset-0 after:rounded-[inherit] after:content-['']",
        'focus-visible:after:ring-ring focus-visible:after:ring-2',
        className,
      )}
    >
      {title}
    </button>
  );
}
