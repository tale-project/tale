'use client';

import type { ComponentType, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { Button, buttonVariants } from '@/components/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/overlays/dropdown-menu';

/** Icon component type that accepts className prop */
export type IconComponent = ComponentType<{ className?: string }>;

/** Menu item for action dropdown */
export interface DataTableActionMenuItem {
  /** Menu item label */
  label: string;
  /** Optional icon */
  icon?: IconComponent;
  /** Click handler */
  onClick: () => void;
  /** Whether the item is disabled */
  disabled?: boolean;
}

export interface DataTableActionMenuProps {
  /** Button label */
  label: string;
  /** Optional icon to display before the label */
  icon?: IconComponent;
  /** Click handler for simple button (ignored if menuItems or href is provided) */
  onClick?: () => void;
  /** Link href for navigation (renders as Link instead of Button) */
  href?: string;
  /** Button variant */
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  /** Menu items for dropdown (renders dropdown menu instead of simple button) */
  menuItems?: DataTableActionMenuItem[];
  /** Dropdown menu alignment */
  align?: 'start' | 'center' | 'end';
  /** Additional class name */
  className?: string;
  /** Children to render instead of default content */
  children?: ReactNode;
}

/**
 * Action menu component for DataTable header and empty states.
 *
 * Supports three modes:
 * 1. Simple button - onClick handler
 * 2. Link button - href for navigation
 * 3. Dropdown menu - menuItems array
 */
export function DataTableActionMenu({
  label,
  icon: Icon,
  onClick,
  href,
  variant,
  menuItems,
  align = 'end',
  className,
  children,
}: DataTableActionMenuProps) {
  // If children are provided, render them directly
  if (children) {
    return <>{children}</>;
  }

  // Render dropdown menu if menuItems provided
  if (menuItems && menuItems.length > 0) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} className={cn('gap-2', className)}>
            {Icon && <Icon className="size-4" />}
            {label}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align}>
          {menuItems.map((item) => {
            const ItemIcon = item.icon;
            return (
              <DropdownMenuItem
                key={item.label}
                onClick={item.onClick}
                disabled={item.disabled}
              >
                {ItemIcon && <ItemIcon className="size-4 mr-2" />}
                {item.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Render link button if href provided
  if (href) {
    return (
      <Link
        href={href}
        className={cn(buttonVariants({ variant }), 'gap-2', className)}
      >
        {Icon && <Icon className="size-4" />}
        {label}
      </Link>
    );
  }

  // Render simple button
  return (
    <Button onClick={onClick} variant={variant} className={cn('gap-2', className)}>
      {Icon && <Icon className="size-4" />}
      {label}
    </Button>
  );
}
