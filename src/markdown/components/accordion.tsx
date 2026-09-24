import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '../../lib/cn';

interface AccordionGroupContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const AccordionGroupContext = createContext<AccordionGroupContextValue | null>(
  null,
);

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
  const reactId = useId();
  const panelId = `${reactId}-panel`;
  const triggerId = `${reactId}-trigger`;
  const group = useContext(AccordionGroupContext);

  const [localOpen, setLocalOpen] = useState(defaultOpen);

  // Register defaultOpen with the group on mount, so only one can win.
  const didRegisterDefault = useRef(false);
  useEffect(() => {
    if (group && defaultOpen && !didRegisterDefault.current) {
      didRegisterDefault.current = true;
      group.setOpenId(reactId);
    }
  }, [group, defaultOpen, reactId]);

  const open = group ? group.openId === reactId : localOpen;

  const toggle = useCallback(() => {
    if (group) {
      group.setOpenId(group.openId === reactId ? null : reactId);
    } else {
      setLocalOpen((v) => !v);
    }
  }, [group, reactId]);

  return (
    <div
      className={cn(
        'border-border-base my-2 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <button
        type="button"
        id={triggerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
        className="text-fg-base hover:bg-bg-elevated/50 focus-visible:ring-ring focus-visible:ring-offset-bg-base flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!open}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div
          className={cn(
            'min-h-0 overflow-hidden',
            !open && 'pointer-events-none',
          )}
        >
          <div className="text-fg-muted border-border-base border-t px-4 py-3 text-sm leading-relaxed">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AccordionGroupProps {
  children?: ReactNode;
}

export function AccordionGroup({ children }: AccordionGroupProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const value = useMemo(() => ({ openId, setOpenId }), [openId]);
  return (
    <AccordionGroupContext.Provider value={value}>
      <div className="my-6 flex flex-col gap-1">{children}</div>
    </AccordionGroupContext.Provider>
  );
}
