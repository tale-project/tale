'use client';

import {
  DropdownMenu,
  type DropdownMenuItem,
  type DropdownMenuGroup,
} from '@tale/ui/dropdown-menu';
import { IconButton } from '@tale/ui/icon-button';
import type { LucideIcon } from 'lucide-react';
import { MoreVertical } from 'lucide-react';
import * as React from 'react';
import { useState, useCallback, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { buildRecord } from '@/lib/utils/type-utils';

export interface EntityRowAction {
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
  /** Whether the entire menu trigger is disabled */
  disabled?: boolean;
  /** Stable focus target for dialogs opened from an unmounting menu item. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
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
  disabled = false,
  triggerRef,
}: EntityRowActionsProps) {
  const { t: tCommon } = useT('common');
  const [isOpen, setIsOpen] = useState(false);

  // Filter visible actions
  const visibleActions = useMemo(
    () => actions.filter((action) => action.visible !== false),
    [actions],
  );

  const handleActionClick = useCallback((action: EntityRowAction) => {
    // Call action first, then close dropdown to prevent focus race conditions
    action.onClick();
    setIsOpen(false);
  }, []);

  if (visibleActions.length === 0) {
    return null;
  }

  // Group actions into separated sections. A divider is inserted either where
  // a call-site asks for one (`separator`) or — automatically — before the
  // first destructive action (delete / archive / …) so every menu visually
  // splits "normal" actions from dangerous ones without each call-site opting
  // in. Consecutive destructive actions, or a section already opened by an
  // explicit separator, stay together (no extra divider between them).
  const menuItems: DropdownMenuGroup[] = [];
  let currentGroup: DropdownMenuItem[] = [];
  let currentGroupIsDestructiveSection = false;
  for (const action of visibleActions) {
    const startsDestructiveSection =
      !!action.destructive && !currentGroupIsDestructiveSection;
    if (
      currentGroup.length > 0 &&
      (action.separator || startsDestructiveSection)
    ) {
      menuItems.push(currentGroup);
      currentGroup = [];
      currentGroupIsDestructiveSection = false;
    }
    // Once a section is opened by an explicit separator or contains a
    // destructive action, later destructive actions join it (no extra divider
    // between consecutive dangerous actions like archive + delete).
    if (action.separator || action.destructive) {
      currentGroupIsDestructiveSection = true;
    }
    currentGroup.push({
      type: 'item',
      label: action.label,
      icon: action.icon,
      onClick: () => handleActionClick(action),
      disabled: action.disabled,
      destructive: action.destructive,
    });
  }
  if (currentGroup.length > 0) {
    menuItems.push(currentGroup);
  }

  return (
    <DropdownMenu
      trigger={
        <IconButton
          ref={triggerRef}
          icon={MoreVertical}
          aria-label={ariaLabel || tCommon('actions.openMenu')}
          className={triggerClassName}
          disabled={disabled}
        />
      }
      items={menuItems}
      align={align}
      contentClassName={contentWidth}
      open={disabled ? false : isOpen}
      onOpenChange={disabled ? undefined : setIsOpen}
    />
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
    buildRecord(keysRef.current, () => false),
  );

  const open = useMemo(
    () =>
      buildRecord(
        keysRef.current,
        (key) => () => setOpenStates((prev) => ({ ...prev, [key]: true })),
      ),
    [],
  );

  const setOpen = useMemo(
    () =>
      buildRecord(
        keysRef.current,
        (key) => (isOpen: boolean) =>
          setOpenStates((prev) => ({ ...prev, [key]: isOpen })),
      ),
    [],
  );

  const closeAll = useCallback(() => {
    setOpenStates(buildRecord(keysRef.current, () => false));
  }, []);

  return {
    isOpen: openStates,
    open,
    setOpen,
    closeAll,
  };
}
