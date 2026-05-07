import { cn } from '@tale/ui/cn';
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useState,
} from 'react';

interface CodeGroupChildProps {
  /** Mintlify uses ` ```lang ` fences inside <CodeGroup>; the title is set via `filename` or the lang label. */
  filename?: string;
  className?: string;
  children?: ReactNode;
}

interface CodeGroupProps {
  children?: ReactNode;
}

/**
 * Mintlify-compatible `<CodeGroup>`: accepts code-block children and
 * surfaces them as tabs labelled by their filename / language. Falls back
 * to a single block when only one child is given.
 */
export function CodeGroup({ children }: CodeGroupProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<CodeGroupChildProps>[];
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;
  if (items.length === 1) return <>{items[0]}</>;

  return (
    <div className="border-border-base bg-bg-elevated my-6 overflow-hidden rounded-lg border">
      <div
        role="tablist"
        aria-label="Code examples"
        className="border-border-base flex gap-1 border-b px-2 pt-2"
      >
        {items.map((child, i) => {
          const label = labelOf(child, i);
          const isActive = i === active;
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(i)}
              className={cn(
                'rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-bg-base text-fg-base'
                  : 'text-fg-muted hover:text-fg-base',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{items[active]}</div>
    </div>
  );
}

function labelOf(child: ReactElement<CodeGroupChildProps>, i: number): string {
  const filename = child.props.filename;
  if (filename) return filename;
  const className = child.props.className ?? '';
  const langMatch = /language-([a-z0-9+-]+)/i.exec(className);
  if (langMatch) return langMatch[1];
  return `Tab ${i + 1}`;
}
