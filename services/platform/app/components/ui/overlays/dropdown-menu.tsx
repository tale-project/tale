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

export type DropdownMenuItem =
  | DropdownMenuActionItem
  | DropdownMenuLabelItem
  | DropdownMenuSubItem
  | DropdownMenuRadioGroupItem
  | DropdownMenuCustomItem;

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
            className="text-primary"
          />
          <circle
            cx="7"
            cy="7"
            r="3.5"
            fill="currentColor"
            className="text-primary"
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
              className="ml-auto size-4"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </DropdownMenuPrimitive.SubTrigger>
          <DropdownMenuPrimitive.SubContent className="bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-lg border p-1 shadow-lg">
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
  }
}

function renderGroups(groups: DropdownMenuGroup[]) {
  return groups.map((group, groupIndex) => (
    <Fragment key={groupIndex}>
      {groupIndex > 0 && (
        <DropdownMenuPrimitive.Separator className="bg-muted -mx-1 my-1 h-px" />
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
            'z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[max(10rem,var(--radix-dropdown-menu-trigger-width))] overflow-y-auto overflow-x-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
            contentClassName,
          )}
        >
          {renderGroups(items)}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
