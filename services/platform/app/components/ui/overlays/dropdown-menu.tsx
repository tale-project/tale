'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { type ComponentType, Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

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
}

export interface DropdownMenuRadioGroupItem {
  type: 'radio-group';
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
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
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function RadioIndicator() {
  return (
    <span className="absolute left-2 flex size-3.5 items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="size-3.5"
      >
        <circle
          cx="7"
          cy="7"
          r="6"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-border"
        />
      </svg>
      <DropdownMenuPrimitive.ItemIndicator className="absolute inset-0 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="size-3.5"
        >
          <circle
            cx="7"
            cy="7"
            r="6"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-blue-600"
          />
          <circle
            cx="7"
            cy="7"
            r="3.5"
            fill="currentColor"
            className="text-blue-600"
          />
        </svg>
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
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
            'relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
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
          <DropdownMenuPrimitive.SubContent className="bg-muted text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-lg border p-1 shadow-lg">
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
              className="focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <RadioIndicator />
              {option.label}
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      );

    case 'item': {
      const Icon = item.icon;
      const menuItem = (
        <DropdownMenuPrimitive.Item
          className={cn(
            'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            item.destructive && 'text-destructive focus:text-destructive',
            item.className,
          )}
          onClick={item.onClick}
          disabled={item.disabled}
        >
          {Icon && <Icon />}
          {typeof item.label === 'string' ? (
            <span>{item.label}</span>
          ) : (
            item.label
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
  contentClassName,
  open,
  onOpenChange,
}: DropdownMenuProps) {
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DropdownMenuPrimitive.Trigger
        asChild
        onClick={(e) => e.stopPropagation()}
      >
        {trigger}
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          sideOffset={4}
          align={align}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[max(10rem,var(--radix-dropdown-menu-trigger-width))] overflow-y-auto overflow-x-hidden rounded-lg border bg-card p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            contentClassName,
          )}
        >
          {renderGroups(items)}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
