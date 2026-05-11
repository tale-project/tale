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
        const language = extractLanguage(child);
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
  return extractFilename(child) ?? extractLanguage(child) ?? `Tab ${i + 1}`;
}

function extractCode(child: ReactElement<CodeGroupChildProps>): string {
  if (typeof child.props.code === 'string') return child.props.code;
  if (typeof child.props.children === 'string') return child.props.children;
  // Markdown path: child is a <pre> (rendered by react-markdown's pre map)
  // whose subtree contains <code class="language-X">…</code>. Stringify the
  // nested code element's children to recover the source text.
  const codeEl = findCodeElement(child.props.children);
  if (!codeEl) return '';
  const codeProps = codeEl.props as { children?: ReactNode };
  return stringifyChildren(codeProps.children);
}

function extractLanguage(
  child: ReactElement<CodeGroupChildProps>,
): string | undefined {
  if (typeof child.props.language === 'string') return child.props.language;
  const className =
    child.props.className ??
    (
      findCodeElement(child.props.children)?.props as
        | { className?: string }
        | undefined
    )?.className ??
    '';
  const langMatch = /language-([a-z0-9+-]+)/i.exec(className);
  return langMatch?.[1];
}

/**
 * Pull a filename label off the child. Honours direct `filename` props
 * (used by `<CodeBlock>` children in Storybook) and the fence metastring
 * (e.g. `` ```python Python `` → "Python") which the
 * `rehype-preserve-code-meta` plugin surfaces as a `data-meta` HTML
 * attribute on the nested `<code>` element.
 */
function extractFilename(
  child: ReactElement<CodeGroupChildProps>,
): string | undefined {
  if (
    typeof child.props.filename === 'string' &&
    child.props.filename.length > 0
  ) {
    return child.props.filename;
  }
  const codeEl = findCodeElement(child.props.children);
  const dataMeta = (codeEl?.props as { 'data-meta'?: string } | undefined)?.[
    'data-meta'
  ];
  if (typeof dataMeta === 'string' && dataMeta.trim().length > 0) {
    return dataMeta.trim();
  }
  return undefined;
}

function findCodeElement(node: ReactNode): ReactElement | null {
  if (node === null || node === undefined || typeof node === 'boolean')
    return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findCodeElement(n);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { className?: string; children?: ReactNode };
  if (
    typeof props.className === 'string' &&
    props.className.includes('language-')
  ) {
    return node;
  }
  return findCodeElement(props.children);
}

function stringifyChildren(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean')
    return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(stringifyChildren).join('');
  if (isValidElement(node)) {
    return stringifyChildren((node.props as { children?: ReactNode }).children);
  }
  return '';
}
