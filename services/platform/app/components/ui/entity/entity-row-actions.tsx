'use client';

import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { MoreVertical } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/app/components/ui/overlays/dropdown-menu';
import { cn } from '@/lib/utils/cn';
import { useT } from '@/lib/i18n/client';

interface EntityRowAction {
  /** Unique key for the action */
  key: string;
  /** Display label for the action */
  label: string;
  /** Icon to display */
  icon: LucideIcon;
  /** Click handler - receives a callback to close the dropdown */
  onClick: () => void;
  /** Whether to show a separator before this action */
  separator?: boolean;
  /** Whether this is a destructive action (shows in red) */
  destructive?: boolean;
  /** Whether the action is disabled */
  disabled?: boolean;
  /** Whether to show this action */
  visible?: boolean;
}

interface EntityRowActionsProps {
  /** Array of actions to display */
  actions: EntityRowAction[];
  /** Optional aria label for the menu trigger */
  ariaLabel?: string;
  /** Additional className for the trigger button */
  triggerClassName?: string;
  /** Content width */
  contentWidth?: string;
  /** Alignment of dropdown */
  align?: 'start' | 'center' | 'end';
}

/**
 * Generic row actions dropdown for entity tables.
 * Provides a consistent UI for view/edit/delete and other row-level actions.
 *
 * @example
 * ```tsx
 * <EntityRowActions
 *   actions={[
 *     { key: 'view', label: 'View Details', icon: Eye, onClick: () => setViewOpen(true) },
 *     { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => setEditOpen(true), separator: true },
 *     { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => setDeleteOpen(true), destructive: true },
 *   ]}
 * />
 * ```
 */
export const EntityRowActions = React.memo(function EntityRowActions({
  actions,
  ariaLabel,
  triggerClassName,
  contentWidth = 'w-[10rem]',
  align = 'end',
}: EntityRowActionsProps) {
  const { t: tCommon } = useT('common');
  const [isOpen, setIsOpen] = useState(false);

  // Filter visible actions
  const visibleActions = useMemo(
    () => actions.filter((action) => action.visible !== false),
    [actions]
  );

  const handleActionClick = useCallback(
    (action: EntityRowAction) => {
      // Call action first, then close dropdown to prevent focus race conditions
      action.onClick();
      setIsOpen(false);
    },
    []
  );

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={MoreVertical}
          aria-label={ariaLabel || tCommon('actions.openMenu')}
          className={triggerClassName}
          onClick={(e) => e.stopPropagation()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentWidth}>
        {visibleActions.map((action) => (
          <React.Fragment key={action.key}>
            {action.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                handleActionClick(action);
              }}
              disabled={action.disabled}
              className={cn(
                action.destructive &&
                  'text-destructive focus:text-destructive'
              )}
            >
              <action.icon className="mr-2 size-4" aria-hidden="true" />
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * Hook to manage dialog states for entity row actions.
 * Returns state and handlers for multiple dialogs.
 *
 * @example
 * ```tsx
 * const dialogs = useEntityRowDialogs(['view', 'edit', 'delete']);
 *
 * // In render:
 * <EntityRowActions
 *   actions={[
 *     { key: 'view', onClick: dialogs.open.view },
 *     { key: 'edit', onClick: dialogs.open.edit },
 *     { key: 'delete', onClick: dialogs.open.delete },
 *   ]}
 * />
 *
 * <ViewDialog open={dialogs.isOpen.view} onOpenChange={dialogs.setOpen.view} />
 * <EditDialog open={dialogs.isOpen.edit} onOpenChange={dialogs.setOpen.edit} />
 * <DeleteDialog open={dialogs.isOpen.delete} onOpenChange={dialogs.setOpen.delete} />
 * ```
 */
export function useEntityRowDialogs<T extends string>(dialogKeys: T[]) {
  // Store keys in a ref to avoid recreating objects on every render
  const keysRef = React.useRef(dialogKeys);

  const [openStates, setOpenStates] = useState<Record<T, boolean>>(() =>
    keysRef.current.reduce(
      (acc, key) => ({ ...acc, [key]: false }),
      {} as Record<T, boolean>
    )
  );

  const open = useMemo(
    () =>
      keysRef.current.reduce(
        (acc, key) => ({
          ...acc,
          [key]: () => setOpenStates((prev) => ({ ...prev, [key]: true })),
        }),
        {} as Record<T, () => void>
      ),
    []
  );

  const setOpen = useMemo(
    () =>
      keysRef.current.reduce(
        (acc, key) => ({
          ...acc,
          [key]: (isOpen: boolean) =>
            setOpenStates((prev) => ({ ...prev, [key]: isOpen })),
        }),
        {} as Record<T, (isOpen: boolean) => void>
      ),
    []
  );

  const closeAll = useCallback(() => {
    setOpenStates(
      keysRef.current.reduce(
        (acc, key) => ({ ...acc, [key]: false }),
        {} as Record<T, boolean>
      )
    );
  }, []);

  return {
    isOpen: openStates,
    open,
    setOpen,
    closeAll,
  };
}
