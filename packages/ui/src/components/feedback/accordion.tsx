import { ChevronDown } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';

import { cn } from '../../lib/cn';

interface AccordionContextValue {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

export interface AccordionProps {
  children: ReactNode;
  /**
   * Controls whether multiple items can be open at the same time.
   * - `'single'` (default) — opening an item closes any other open item.
   * - `'multiple'` — items open and close independently.
   */
  type?: 'single' | 'multiple';
  /** Initial open item id(s). For `single`, pass a string; for `multiple`, pass an array. */
  defaultOpen?: string | string[] | null;
  className?: string;
}

export function Accordion({
  children,
  type = 'single',
  defaultOpen = null,
  className,
}: AccordionProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    if (defaultOpen === null) return new Set();
    return new Set(Array.isArray(defaultOpen) ? defaultOpen : [defaultOpen]);
  });

  const value = useMemo<AccordionContextValue>(
    () => ({
      isOpen: (id) => openIds.has(id),
      toggle: (id) =>
        setOpenIds((prev) => {
          const next = new Set(type === 'multiple' ? prev : []);
          if (prev.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        }),
    }),
    [openIds, type],
  );
  return (
    <AccordionContext.Provider value={value}>
      <div className={cn('flex flex-col', className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  id?: string;
  question: ReactNode;
  children: ReactNode;
  /**
   * Heading level wrapping the trigger button (WAI-ARIA accordion pattern).
   * Pick the level that continues the page's heading outline.
   */
  headingLevel?: 2 | 3 | 4;
  /** Wrapper class applied to the outer item container. */
  className?: string;
  /** Class applied to the trigger button — overrides the default typography. */
  triggerClassName?: string;
  /** Class applied to the expanded content. */
  contentClassName?: string;
}

export function AccordionItem({
  id,
  question,
  children,
  headingLevel = 3,
  className,
  triggerClassName,
  contentClassName,
}: AccordionItemProps) {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('AccordionItem must be used inside Accordion');
  const generatedId = useId();
  const itemId = id ?? generatedId;
  const isOpen = ctx.isOpen(itemId);

  // The panel stays mounted so its text ships in prerendered HTML — crawlers,
  // llms-full.txt, and the per-page `.md` all read the closed answers. That
  // only works if the server markup carries no `aria-hidden` (the markdown
  // transform drops such subtrees), so the collapsed a11y state is applied
  // after mount — effects never run during renderToString.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const hideClosed = !isOpen && mounted;

  return (
    <div className={cn('border-border-base border-b px-5 py-5', className)}>
      {createElement(
        `h${headingLevel}`,
        { className: 'm-0' },
        <button
          type="button"
          onClick={() => ctx.toggle(itemId)}
          aria-expanded={isOpen}
          aria-controls={`${itemId}-content`}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between gap-4 text-left text-xl font-medium text-[color:var(--color-fg-base)] transition-colors hover:text-[color:var(--color-accent-base)]',
            triggerClassName,
          )}
          style={{ lineHeight: 1.4 }}
        >
          <span>{question}</span>
          <ChevronDown
            aria-hidden
            strokeWidth={2}
            className={cn(
              'h-6 w-6 shrink-0 text-[color:var(--color-fg-muted)] motion-safe:transition-transform motion-safe:duration-400 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
              isOpen ? 'rotate-180' : '',
            )}
          />
        </button>,
      )}
      <div
        id={`${itemId}-content`}
        aria-hidden={hideClosed || undefined}
        inert={hideClosed || undefined}
        className={cn(
          'grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-400 motion-safe:ease-[cubic-bezier(0.32,0.72,0,1)]',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              'text-fg-muted max-w-xl pt-3 text-base',
              contentClassName,
            )}
            style={{ letterSpacing: '-0.0072em', lineHeight: 1.5 }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
