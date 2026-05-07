import { cn } from '@tale/ui/cn';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from 'react';

interface TabProps {
  title: string;
  children?: ReactNode;
}

export function Tab(_: TabProps) {
  // Rendered indirectly by <Tabs>; this exists only as a typed marker so MDX
  // authors get the same prop API as Mintlify.
  return null;
}

interface TabsProps {
  children?: ReactNode;
}

export function Tabs({ children }: TabsProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<TabProps>[];
  const [active, setActive] = useState(0);
  if (items.length === 0) return null;
  return (
    <div className="my-6">
      <div
        role="tablist"
        className="border-border-base flex gap-4 border-b text-sm"
      >
        {items.map((item, i) => {
          const isActive = i === active;
          return (
            <button
              key={`${item.props.title}-${i}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(i)}
              className={cn(
                '-mb-px border-b-2 pb-2 font-medium transition-colors',
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
      <div role="tabpanel" className="pt-4">
        {items[active]?.props.children}
      </div>
    </div>
  );
}
