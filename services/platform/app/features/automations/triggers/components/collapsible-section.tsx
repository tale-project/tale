'use client';

import { Badge } from '@tale/ui/badge';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Heading } from '@/app/components/ui/typography/heading';
import { cn } from '@/lib/utils/cn';

interface CollapsibleSectionProps {
  id: string;
  icon: LucideIcon;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  icon: Icon,
  title,
  count,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(() => defaultOpen);
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <Heading id={headingId} level={3} size="sm" weight="medium">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={`${id}-content`}
          className="flex w-full items-center gap-2 py-1 select-none"
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
      {isOpen && (
        <div id={`${id}-content`} className="mt-2">
          {children}
        </div>
      )}
    </section>
  );
}
