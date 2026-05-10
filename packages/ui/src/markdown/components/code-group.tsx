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
import { HighlightedCode } from '../highlighted-code';

interface CodeGroupChildProps {
  /** Code source. Direct prop on a `<CodeBlock>` child. */
  code?: string;
  /** Optional filename label rendered as the tab title. */
  filename?: string;
  /** Optional language identifier (Shiki + tab fallback label). */
  language?: string;
  /** ` ```lang ` fence syntax sugar — preserved for Mintlify-style nesting. */
  className?: string;
  /** When `code` isn't passed directly, fall back to children text. */
  children?: ReactNode;
}

interface CodeGroupProps {
  children?: ReactNode;
  className?: string;
}

/**
 * Mintlify-compatible `<CodeGroup>` — the surrounding chrome is owned by
 * CodeGroup itself rather than nested under each `<CodeBlock>` child, so
 * tabs sit flush with the code panel and the bordered card has a single
 * outline. Each child contributes a tab labelled by `filename` /
 * `language` and a panel rendering the highlighted source via the same
 * `<HighlightedCode>` body the standalone `<CodeBlock>` uses.
 *
 * All panels stay mounted (inactive ones hidden) so switching tabs
 * preserves Shiki's already-rendered highlight.
 */
export function CodeGroup({ children, className }: CodeGroupProps) {
  const items = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<CodeGroupChildProps>[];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const groupId = useId();

  if (items.length === 0) return null;

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
    <div
      className={cn(
        'border-border-base bg-bg-elevated my-6 overflow-hidden rounded-lg border',
        className,
      )}
    >
      <div
        role="tablist"
        aria-label="Code examples"
        className="border-border-base flex items-stretch border-b"
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
                '-mb-px border-b-2 px-4 py-2 font-mono text-xs transition-colors focus:outline-none focus-visible:bg-bg-base/40',
                isActive
                  ? 'border-fg-base text-fg-base'
                  : 'text-fg-muted hover:text-fg-base border-transparent',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      {items.map((child, i) => {
        const isActive = i === active;
        const tabId = `${groupId}-tab-${i}`;
        const panelId = `${groupId}-panel-${i}`;
        const code = extractCode(child);
        const language = child.props.language ?? extractLanguage(child);
        return (
          <div
            key={panelId}
            id={panelId}
            role="tabpanel"
            aria-labelledby={tabId}
            hidden={!isActive}
          >
            <HighlightedCode code={code} language={language} showCopyButton />
          </div>
        );
      })}
    </div>
  );
}

function labelOf(child: ReactElement<CodeGroupChildProps>, i: number): string {
  const filename = child.props.filename;
  if (filename) return filename;
  const language = child.props.language ?? extractLanguage(child);
  if (language) return language;
  return `Tab ${i + 1}`;
}

function extractCode(child: ReactElement<CodeGroupChildProps>): string {
  if (typeof child.props.code === 'string') return child.props.code;
  if (typeof child.props.children === 'string') return child.props.children;
  return '';
}

function extractLanguage(
  child: ReactElement<CodeGroupChildProps>,
): string | undefined {
  const className = child.props.className ?? '';
  const langMatch = /language-([a-z0-9+-]+)/i.exec(className);
  return langMatch?.[1];
}
