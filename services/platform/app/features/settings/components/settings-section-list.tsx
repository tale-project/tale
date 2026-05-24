'use client';

import { Description } from '@tale/ui/description';
import { Link } from '@tanstack/react-router';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export interface SettingsSectionListItem {
  key: string;
  label: ReactNode;
  description?: ReactNode;
  href: string;
  icon?: LucideIcon;
}

export interface SettingsSectionListGroup {
  key: string;
  label?: ReactNode;
  items: SettingsSectionListItem[];
}

interface SettingsSectionListProps {
  groups: SettingsSectionListGroup[];
  className?: string;
  ariaLabel?: string;
}

/**
 * iOS-style grouped list used as the mobile navigation for the settings
 * surface. Each row is a Link with label + optional description + chevron.
 * Groups are visually separated with a small gap and a header label.
 */
export function SettingsSectionList({
  groups,
  className,
  ariaLabel,
}: SettingsSectionListProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('flex flex-col gap-7', className)}
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          {group.label && (
            <div className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
              {group.label}
            </div>
          )}
          <ul
            role="list"
            className="border-border bg-card flex flex-col rounded-lg border"
          >
            {group.items.map((item, index) => {
              const Icon = item.icon;
              return (
                <li
                  key={item.key}
                  className={cn(index > 0 && 'border-border border-t')}
                >
                  <Link
                    to={item.href}
                    className="hover:bg-muted/40 flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg"
                  >
                    {Icon && (
                      <Icon
                        aria-hidden="true"
                        className="text-muted-foreground size-5 shrink-0"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-foreground text-sm leading-tight font-medium">
                        {item.label}
                      </span>
                      {item.description && (
                        <Description className="text-xs">
                          {item.description}
                        </Description>
                      )}
                    </div>
                    <ChevronRight
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
