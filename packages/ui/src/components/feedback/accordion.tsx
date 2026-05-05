import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import {
  type ReactNode,
  createContext,
  useContext,
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
      <div
        className={cn(
          'flex flex-col divide-y divide-[color:var(--color-border-base)]',
          className,
        )}
      >
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  id?: string;
  question: ReactNode;
  children: ReactNode;
  className?: string;
}

export function AccordionItem({
  id,
  question,
  children,
  className,
}: AccordionItemProps) {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('AccordionItem must be used inside Accordion');
  const generatedId = useId();
  const itemId = id ?? generatedId;
  const isOpen = ctx.isOpen(itemId);
  const reduceMotion = useReducedMotion();

  return (
    <div className={cn('px-5 py-5', className)}>
      <button
        type="button"
        onClick={() => ctx.toggle(itemId)}
        aria-expanded={isOpen}
        aria-controls={`${itemId}-content`}
        className="flex w-full items-center justify-between gap-4 text-left text-base font-medium text-[color:var(--color-fg-base)] transition-colors hover:text-[color:var(--color-accent-base)]"
      >
        <span>{question}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'h-4 w-4 shrink-0 text-[color:var(--color-fg-muted)] motion-safe:transition-transform motion-safe:duration-300 motion-reduce:transition-none',
            isOpen && 'rotate-180',
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={`${itemId}-content`}
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={
              reduceMotion
                ? { height: 'auto', opacity: 1 }
                : { height: 0, opacity: 0 }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
            }
            className="overflow-hidden"
          >
            <div className="pt-3 text-sm leading-relaxed text-[color:var(--color-fg-muted)]">
              {children}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
