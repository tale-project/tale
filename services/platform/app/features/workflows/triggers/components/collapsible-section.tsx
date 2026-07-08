'use client';

import { Badge } from '@tale/ui/badge';
import { Heading } from '@tale/ui/heading';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface CollapsibleSectionProps {
  id: string;
  icon: LucideIcon;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  icon: Icon,
  title,
  count,
  defaultOpen = false,
  action,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => defaultOpen);
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Heading id={headingId} level={3} size="sm" weight="medium">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={`${id}-content`}
            className="flex items-center gap-2 py-1 select-none"
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronRight
              className={cn(
                'size-3.5 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-90',
              )}
            />
            <Icon className="text-muted-foreground size-4" />
            <span>{title}</span>
            {typeof count === 'number' && (
              <Badge variant="outline" className="ml-1 text-xs">
                {count}
              </Badge>
            )}
          </button>
        </Heading>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {isOpen && (
        <div id={`${id}-content`} className="mt-2">
          {children}
        </div>
      )}
    </section>
  );
}
