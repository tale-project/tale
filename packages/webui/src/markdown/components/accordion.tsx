import { cn } from '@tale/ui/cn';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';

interface AccordionProps {
  title: string;
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Accordion({
  title,
  defaultOpen = false,
  children,
  className,
}: AccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div
      className={cn(
        'border-border-base my-2 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="text-fg-base hover:bg-bg-elevated/50 flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div
          id={panelId}
          className="text-fg-muted border-border-base border-t px-4 py-3 text-sm leading-relaxed"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface AccordionGroupProps {
  children?: ReactNode;
}

export function AccordionGroup({ children }: AccordionGroupProps) {
  return <div className="my-6 flex flex-col gap-1">{children}</div>;
}
