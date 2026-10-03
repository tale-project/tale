import {
  Children,
  isValidElement,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../../lib/cn';

interface TabProps {
  title: string;
  children?: ReactNode;
}

export function Tab(_: TabProps) {
  // Rendered indirectly by <Tabs>; this exists only as a typed marker so MDX
  // authors get a typed prop API.
  return null;
}

interface TabsProps {
  children?: ReactNode;
}

export function Tabs({ children }: TabsProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<TabProps>[];
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  if (items.length === 0) return null;

  const focusTab = (index: number) => {
    setActive(index);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTab((active + 1) % items.length);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTab((active - 1 + items.length) % items.length);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(items.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="my-6">
      <div
        role="tablist"
        className="border-border-base flex gap-4 border-b text-sm"
      >
        {items.map((item, i) => {
          const isActive = i === active;
          const tabId = `${baseId}-tab-${i}`;
          const panelId = `${baseId}-panel-${i}`;
          return (
            <button
              key={tabId}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId}
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
              className={cn(
                'focus-visible:ring-ring focus-visible:ring-offset-bg-base -mb-px border-b-2 pb-2 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                isActive
                  ? 'border-fg-base text-fg-base'
                  : 'text-fg-muted hover:text-fg-base border-transparent',
              )}
            >
              {item.props.title}
            </button>
          );
        })}
      </div>
      {items.map((item, i) => {
        const isActive = i === active;
        const tabId = `${baseId}-tab-${i}`;
        const panelId = `${baseId}-panel-${i}`;
        return (
          <div
            key={panelId}
            role="tabpanel"
            id={panelId}
            aria-labelledby={tabId}
            hidden={!isActive}
            tabIndex={0}
            className="pt-4 focus:outline-none"
          >
            {isActive ? item.props.children : null}
          </div>
        );
      })}
    </div>
  );
}
