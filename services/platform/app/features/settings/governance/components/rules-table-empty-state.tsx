import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

interface RulesTableEmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Centred empty-state rendered inside a rules table's bordered container.
 * Mirrors the `a7Q0S` frame in the Pencil governance designs: icon, title,
 * and optional description stacked vertically with ~40px vertical padding.
 */
export function RulesTableEmptyState({
  icon: Icon,
  title,
  description,
  className,
}: RulesTableEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-5 py-10 text-center',
        className,
      )}
    >
      {Icon && <Icon className="text-muted-foreground size-8" />}
      <p className="text-foreground text-sm font-medium">{title}</p>
      {description && (
        <p className="text-muted-foreground text-sm">{description}</p>
      )}
    </div>
  );
}
