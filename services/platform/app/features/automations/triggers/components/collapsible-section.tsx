'use client';

import { useState, type ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
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
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={`${id}-content`}
        className="flex w-full items-center gap-2 select-none py-1"
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground transition-transform duration-200',
            isOpen && 'rotate-90',
          )}
        />
        <Icon className="size-4 text-muted-foreground" />
        <h3 id={headingId} className="text-sm font-medium text-foreground">
          {title}
        </h3>
      </button>
      {isOpen && (
        <div id={`${id}-content`} className="mt-3">
          {children}
        </div>
      )}
    </section>
  );
}
