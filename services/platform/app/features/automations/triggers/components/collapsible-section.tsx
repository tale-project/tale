'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

interface CollapsibleSectionProps {
  id: string;
  icon: LucideIcon;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const headingId = `${id}-heading`;

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-foreground text-sm font-medium">
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
        </button>
      </h3>
      {isOpen && (
        <div id={`${id}-content`} className="mt-3">
          {children}
        </div>
      )}
    </section>
  );
}
