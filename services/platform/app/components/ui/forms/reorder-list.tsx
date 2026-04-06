'use client';

import { Reorder, useDragControls, type DragControls } from 'framer-motion';
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
import { type ReactNode, useCallback } from 'react';

import { cn } from '@/lib/utils/cn';

import { IconButton } from '../primitives/icon-button';

export interface ReorderItem {
  id: string;
}

export interface ReorderListItemProps<T extends ReorderItem> {
  item: T;
  index: number;
  total: number;
  dragControls: DragControls;
}

interface ReorderListProps<T extends ReorderItem> {
  items: T[];
  onReorder: (items: T[]) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (id: string) => void;
  renderItem: (props: ReorderListItemProps<T>) => ReactNode;
  /** When true, hides drag handle, up/down arrows, and remove button */
  readonlyOrder?: boolean;
  className?: string;
  moveUpLabel: string;
  moveDownLabel: string;
  dragHandleLabel: string;
  removeLabel: string;
}

interface ReorderListRowProps<T extends ReorderItem> {
  item: T;
  index: number;
  total: number;
  readonlyOrder: boolean;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onRemove: (id: string) => void;
  renderItem: (props: ReorderListItemProps<T>) => ReactNode;
  moveUpLabel: string;
  moveDownLabel: string;
  dragHandleLabel: string;
  removeLabel: string;
}

function ReorderListRow<T extends ReorderItem>({
  item,
  index,
  total,
  readonlyOrder,
  onMoveUp,
  onMoveDown,
  onRemove,
  renderItem,
  moveUpLabel,
  moveDownLabel,
  dragHandleLabel,
  removeLabel,
}: ReorderListRowProps<T>) {
  const dragControls = useDragControls();

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={dragControls}
      drag={!readonlyOrder}
      className="flex items-center gap-2"
    >
      {!readonlyOrder && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0 cursor-grab touch-none rounded p-1 active:cursor-grabbing"
          aria-label={dragHandleLabel}
          onPointerDown={(e) => dragControls.start(e)}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      <div className="min-w-0 flex-1">
        {renderItem({ item, index, total, dragControls })}
      </div>

      {!readonlyOrder && (
        <>
          <div className="flex shrink-0 flex-row">
            <IconButton
              icon={ChevronUp}
              aria-label={moveUpLabel}
              onClick={() => onMoveUp(index)}
              disabled={index === 0}
              className="size-7"
              iconSize={4}
            />
            <IconButton
              icon={ChevronDown}
              aria-label={moveDownLabel}
              onClick={() => onMoveDown(index)}
              disabled={index === total - 1}
              className="size-7"
              iconSize={4}
            />
          </div>

          <IconButton
            icon={X}
            aria-label={removeLabel}
            onClick={() => onRemove(item.id)}
            className="shrink-0"
            iconSize={4}
          />
        </>
      )}
    </Reorder.Item>
  );
}

export function ReorderList<T extends ReorderItem>({
  items,
  onReorder,
  onMoveUp,
  onMoveDown,
  onRemove,
  renderItem,
  readonlyOrder = false,
  className,
  moveUpLabel,
  moveDownLabel,
  dragHandleLabel,
  removeLabel,
}: ReorderListProps<T>) {
  const handleReorder = useCallback(
    (newItems: T[]) => {
      onReorder(newItems);
    },
    [onReorder],
  );

  return (
    <Reorder.Group
      axis="y"
      values={items}
      onReorder={handleReorder}
      className={cn('flex flex-col gap-3', className)}
    >
      {items.map((item, index) => (
        <ReorderListRow
          key={item.id}
          item={item}
          index={index}
          total={items.length}
          readonlyOrder={readonlyOrder}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onRemove={onRemove}
          renderItem={renderItem}
          moveUpLabel={moveUpLabel}
          moveDownLabel={moveDownLabel}
          dragHandleLabel={dragHandleLabel}
          removeLabel={removeLabel}
        />
      ))}
    </Reorder.Group>
  );
}
