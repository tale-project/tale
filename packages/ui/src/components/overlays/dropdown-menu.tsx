'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import { type ComponentType, Fragment, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { TooltipContent } from './tooltip';

export interface DropdownMenuActionItem {
  type: 'item';
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
  href?: string;
  external?: boolean;
  /** Keep the menu open after click. Use for items that swap the menu's content in place. */
  keepOpen?: boolean;
  /**
   * Muted text pinned to the right of the row (e.g. "Requires Tavily"). When
   * combined with `selected`, the trailing text sits to the *left* of the
   * checkmark so the check always reads as the right-most element.
   */
  trailing?: ReactNode;
  /**
   * Render a right-aligned check on the row to mark it as the active choice.
   * Use this instead of baking a "✓" into the label so the mark is pinned to
   * the far right of the row regardless of label length or any `trailing`.
   */
  selected?: boolean;
}

export interface DropdownMenuLabelItem {
  type: 'label';
  content: ReactNode;
  className?: string;
}

export interface DropdownMenuSubItem {
  type: 'sub';
  label: string;
  icon?: ComponentType<{ className?: string }>;
  items: DropdownMenuGroup[];
  className?: string;
  /** Optional trailing text shown before the chevron (e.g. current selection). */
  trailing?: ReactNode;
  /**
   * Extra classes applied to the sub-menu content panel. Use when the
   * default `min-w-[8rem]` is too narrow for the embedded content (e.g.
   * an org switcher row with name + slug + role).
   */
  contentClassName?: string;
}

export interface DropdownMenuRadioGroupItem {
  type: 'radio-group';
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
}

export interface DropdownMenuCustomItem {
  type: 'custom';
  content: ReactNode;
}

/**
 * Boolean toggle rendered inside the menu. Renders as
 * `DropdownMenuPrimitive.CheckboxItem` so Radix's roving-tabindex
 * picks it up (arrow-key navigation works) and screen readers announce
 * `role="menuitemcheckbox"` + `aria-checked`. `onSelect` is suppressed so
 * activating the toggle keeps the menu open. Round-1 / round-2 HIGH #13.
 */
export interface DropdownMenuCheckboxItem {
  type: 'checkbox';
  label: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export type DropdownMenuItem =
  | DropdownMenuActionItem
  | DropdownMenuLabelItem
  | DropdownMenuSubItem
  | DropdownMenuRadioGroupItem
  | DropdownMenuCustomItem
  | DropdownMenuCheckboxItem;

export type DropdownMenuGroup = DropdownMenuItem[];

interface DropdownMenuProps {
  trigger: ReactNode;
  items: DropdownMenuGroup[];
  align?: 'start' | 'center' | 'end';
  /** Side the menu opens on. @default 'bottom' (Radix default) */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Gap between the trigger and the menu. @default 4 */
  sideOffset?: number;
  /**
   * Distance the menu keeps from the viewport edges before Radix shifts it.
   * The default suits floating menus; an edge-anchored panel (the rail's
   * account menu) passes the rail's own inset so alignment with its trigger
   * survives near the viewport edge.
   */
  collisionPadding?: number;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional hover/focus tooltip for the trigger. When set, the trigger is
   * composed with a Radix tooltip (both triggers share the same DOM node via
   * `asChild`), so the menu still opens on click while the tooltip explains it
   * on hover. Handy for icon-only triggers in dense toolbars.
   */
  tooltip?: ReactNode;
  /** Side the tooltip opens on. @default 'top' */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Disables the trigger at the Radix level so the menu can't open — a
   *  disabled child <button> alone doesn't stop keyboard/pointer activation. */
  disabled?: boolean;
}

function RadioIndicator() {
  return (
    <DropdownMenuPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
      <Check className="size-3.5" />
    </DropdownMenuPrimitive.ItemIndicator>
  );
}

function renderItem(item: DropdownMenuItem, key: number) {
  switch (item.type) {
    case 'label':
      return (
        <DropdownMenuPrimitive.Label
          key={key}
          className={cn('px-2 py-1.5 text-sm font-semibold', item.className)}
        >
          {item.content}
        </DropdownMenuPrimitive.Label>
      );

    case 'custom':
      return <Fragment key={key}>{item.content}</Fragment>;

    case 'checkbox': {
      const CheckboxIcon = item.icon;
      return (
        <DropdownMenuPrimitive.CheckboxItem
          key={key}
          checked={item.checked}
          onCheckedChange={item.onCheckedChange}
          disabled={item.disabled}
          // Prevent default suppresses the close-on-select behaviour so
          // toggling stays inside the menu — matches the OS conventions
          // for grouped settings dropdowns.
          onSelect={(e) => e.preventDefault()}
          className={cn(
            'relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-base outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            item.className,
          )}
        >
          {CheckboxIcon ? <CheckboxIcon /> : null}
          <span className="flex flex-1 flex-col">
            <span className="text-sm">{item.label}</span>
            {item.description != null && (
              <span className="text-muted-foreground text-xs">
                {item.description}
              </span>
            )}
          </span>
          <DropdownMenuPrimitive.ItemIndicator
            forceMount
            className="ml-auto inline-flex"
          >
            <span
              aria-hidden
              className={cn(
                'inline-block h-4 w-7 rounded-full transition-colors',
                item.checked ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform',
                  item.checked ? 'translate-x-3.5' : 'translate-x-0.5',
                )}
              />
            </span>
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.CheckboxItem>
      );
    }

    case 'sub': {
      const SubIcon = item.icon;
      return (
        <DropdownMenuPrimitive.Sub key={key}>
          <DropdownMenuPrimitive.SubTrigger
            className={cn(
              'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
              item.className,
            )}
          >
            {SubIcon && <SubIcon />}
            <span>{item.label}</span>
            {item.trailing != null && (
              <span className="text-muted-foreground ml-auto max-w-[10rem] truncate text-xs">
                {item.trailing}
              </span>
            )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                'size-4 shrink-0',
                item.trailing == null && 'ml-auto',
              )}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </DropdownMenuPrimitive.SubTrigger>
          <DropdownMenuPrimitive.SubContent
            // A 16px visual gap to the parent panel — the same distance the
            // panel keeps to its own anchor. Radix measures from the trigger
            // item, which sits inside the panel's 4px padding and 1px border,
            // so those are added back here.
            sideOffset={21}
            collisionPadding={16}
            className={cn(
              'bg-card text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none z-50 min-w-[8rem] overflow-hidden rounded-lg border p-1 shadow-lg',
              item.contentClassName,
            )}
          >
            {renderGroups(item.items)}
          </DropdownMenuPrimitive.SubContent>
        </DropdownMenuPrimitive.Sub>
      );
    }

    case 'radio-group':
      return (
        <DropdownMenuPrimitive.RadioGroup
          key={key}
          value={item.value}
          onValueChange={item.onValueChange}
        >
          {item.options.map((option) => (
            <DropdownMenuPrimitive.RadioItem
              key={option.value}
              value={option.value}
              className="focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <RadioIndicator />
              {option.label}
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      );

    case 'item': {
      const Icon = item.icon;
      const hasTrailing = item.trailing != null || item.selected === true;
      const menuItem = (
        <DropdownMenuPrimitive.Item
          className={cn(
            'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            item.destructive && 'text-destructive focus:text-destructive',
            item.className,
          )}
          // `keepOpen` items swap the panel's contents in place, so run the
          // handler on `onSelect` — which fires for BOTH pointer and keyboard
          // activation — and preventDefault to keep the menu open. Routing
          // through `onClick` (pointer-only) would make the item unreachable by
          // keyboard; wiring both would double-fire on click.
          onClick={item.keepOpen ? undefined : item.onClick}
          onSelect={
            item.keepOpen
              ? (e) => {
                  e.preventDefault();
                  item.onClick?.();
                }
              : undefined
          }
          disabled={item.disabled}
        >
          {Icon && <Icon />}
          {typeof item.label === 'string' ? (
            // When the row carries a trailing slot, let the label flex and
            // truncate so the trailing text / checkmark stay pinned right.
            <span className={cn(hasTrailing && 'min-w-0 flex-1 truncate')}>
              {item.label}
            </span>
          ) : (
            item.label
          )}
          {item.trailing != null && (
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {item.trailing}
            </span>
          )}
          {item.selected === true && (
            <Check
              aria-hidden
              className={cn(
                'text-muted-foreground size-4 shrink-0',
                // Pin the check to the far right. With no `trailing` text it
                // claims the free space itself; with trailing text the
                // trailing span owns `ml-auto` and the check trails it.
                item.trailing == null && 'ml-auto',
              )}
            />
          )}
        </DropdownMenuPrimitive.Item>
      );

      if (item.href) {
        return (
          <a
            key={key}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noopener noreferrer' : undefined}
          >
            {menuItem}
          </a>
        );
      }

      return <Fragment key={key}>{menuItem}</Fragment>;
    }
    default:
      return undefined;
  }
}

function renderGroups(groups: DropdownMenuGroup[]) {
  return groups.map((group, groupIndex) => (
    <Fragment key={groupIndex}>
      {groupIndex > 0 && (
        <DropdownMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
      )}
      {group.map((item, itemIndex) => renderItem(item, itemIndex))}
    </Fragment>
  ));
}

export function DropdownMenu({
  trigger,
  items,
  align,
  side,
  sideOffset,
  collisionPadding,
  contentClassName,
  open,
  onOpenChange,
  tooltip,
  tooltipSide = 'top',
  disabled,
}: DropdownMenuProps) {
  const triggerEl = (
    <DropdownMenuPrimitive.Trigger
      asChild
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
    >
      {trigger}
    </DropdownMenuPrimitive.Trigger>
  );

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {tooltip ? (
        // Radix's documented composition for "tooltip on a menu trigger":
        // both `asChild` triggers collapse onto the same button so the menu
        // still opens on click while the tooltip shows on hover/focus.
        <TooltipPrimitive.Provider delayDuration={300}>
          <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>
              {triggerEl}
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              {/* collisionPadding keeps the tooltip off the viewport edge so it
                  can't visually overlap adjacent controls in dense toolbars. */}
              <TooltipContent side={tooltipSide} collisionPadding={8}>
                {tooltip}
              </TooltipContent>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      ) : (
        triggerEl
      )}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side={side}
          sideOffset={sideOffset ?? 4}
          align={align}
          collisionPadding={collisionPadding ?? 16}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'z-50 max-h-(--radix-dropdown-menu-content-available-height) max-w-(--radix-dropdown-menu-content-available-width) min-w-[max(10rem,var(--radix-dropdown-menu-trigger-width))] overflow-y-auto overflow-x-hidden rounded-lg border bg-card p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 motion-reduce:animate-none',
            contentClassName,
          )}
        >
          {renderGroups(items)}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
