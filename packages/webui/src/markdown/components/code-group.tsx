import { cn } from '@tale/ui/cn';
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

interface CodeGroupChildProps {
  /** Mintlify uses ` ```lang ` fences inside <CodeGroup>; the title is set via `filename` or the lang label. */
  filename?: string;
  /** Direct prop when authors use <CodeBlock language="..."> inside <CodeGroup>. */
  language?: string;
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
 *
 * All panels stay mounted (inactive ones hidden) so switching tabs is
 * instant and Shiki's already-rendered highlight survives the swap.
 */
export function CodeGroup({ children }: CodeGroupProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<CodeGroupChildProps>[];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = useId();

  if (items.length === 0) return null;
  if (items.length === 1) return <>{items[0]}</>;

  const focusTab = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    tabRefs.current[next]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      focusTab(i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focusTab(i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusTab(items.length - 1);
    }
  };

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
          const tabId = `${groupId}-tab-${i}`;
          const panelId = `${groupId}-panel-${i}`;
          return (
            <button
              key={tabId}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId}
              aria-controls={panelId}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              className={cn(
                'rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-current/30',
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
      {/*
        Render every panel once and toggle visibility instead of remounting.
        Remounting would force the inner <CodeBlock> to re-run Shiki on each
        tab switch, briefly flashing unhighlighted text.
      */}
      {items.map((child, i) => {
        const isActive = i === active;
        const tabId = `${groupId}-tab-${i}`;
        const panelId = `${groupId}-panel-${i}`;
        return (
          <div
            key={panelId}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            hidden={!isActive}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

function labelOf(child: ReactElement<CodeGroupChildProps>, i: number): string {
  const filename = child.props.filename;
  if (filename) return filename;
  const language = child.props.language;
  if (language) return language;
  const className = child.props.className ?? '';
  const langMatch = /language-([a-z0-9+-]+)/i.exec(className);
  if (langMatch) return langMatch[1];
  return `Tab ${i + 1}`;
}
