import {
  Children,
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

import { cn } from '../lib/cn';
import { AnchoredHeading } from './anchored-heading';
import { CodeBlock } from './code-block';
import { Callout } from './components/callout';
import { Mermaid } from './components/mermaid';
import { rehypeNumericColumns } from './plugins/rehype-numeric-columns';

type AlertTone = 'note' | 'tip' | 'info' | 'warning' | 'danger';

const ALERT_TYPE_TO_TONE: Record<string, AlertTone> = {
  NOTE: 'note',
  TIP: 'tip',
  IMPORTANT: 'info',
  WARNING: 'warning',
  CAUTION: 'danger',
};

const ALERT_PATTERN = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/;

/**
 * Walk a blockquote's children to detect a GFM alert marker (`[!NOTE]` etc.)
 * in the first paragraph's first text node. Returns the matched tone and a new
 * children array with the marker (and its trailing `<br>` if present) stripped.
 */
function detectAlert(
  children: ReactNode,
): { tone: AlertTone; rest: ReactNode } | null {
  const arr = Children.toArray(children);
  // Find the first paragraph (skip whitespace text nodes).
  const firstParaIdx = arr.findIndex(
    (node) =>
      isValidElement(node) &&
      (node.type === 'p' ||
        (typeof node.type === 'string' && node.type === 'p')),
  );
  if (firstParaIdx === -1) return null;
  const firstPara = arr[firstParaIdx];
  if (!isValidElement(firstPara)) return null;
  const paraProps = firstPara.props as { children?: ReactNode };
  const paraChildren = Children.toArray(paraProps.children);
  const firstChild = paraChildren[0];
  if (typeof firstChild !== 'string') return null;
  const match = ALERT_PATTERN.exec(firstChild);
  if (!match) return null;
  const tone = ALERT_TYPE_TO_TONE[match[1]];
  if (!tone) return null;

  // Strip the marker and any immediately-following whitespace/<br> nodes.
  const trimmedFirst = firstChild.slice(match[0].length).replace(/^\s+/, '');
  const newParaChildren: ReactNode[] = [];
  if (trimmedFirst.length > 0) newParaChildren.push(trimmedFirst);
  for (let i = 1; i < paraChildren.length; i++) {
    const node = paraChildren[i];
    // Skip a leading <br/> that GFM-alert syntax emits between marker and body.
    if (
      newParaChildren.length === 0 &&
      isValidElement(node) &&
      (node.type === 'br' ||
        (typeof node.type === 'string' && node.type === 'br'))
    ) {
      continue;
    }
    newParaChildren.push(node);
  }

  // Re-render the first paragraph with the marker stripped (or drop it if
  // empty). We can't clone the element directly through react-markdown's
  // component map, so just emit a new <p>; the outer Callout styles `[&_p]`.
  const replacement: ReactNode =
    newParaChildren.length === 0 ? null : (
      <p
        key="alert-first"
        className="my-2 leading-relaxed first:mt-0 last:mb-0"
      >
        {newParaChildren}
      </p>
    );
  const newArr = arr
    .map((node, i) => (i === firstParaIdx ? replacement : node))
    .filter((node) => node !== null);
  return { tone, rest: newArr };
}

interface MarkdownProps {
  children: string;
  /** Override or extend the component map. */
  components?: Components;
  className?: string;
}

/**
 * Default `components` map applied by `<Markdown>`. Exported so streaming
 * variants (IncrementalMarkdown) and other wrappers render visually
 * identical prose without re-defining every element.
 */
export const baseComponents: Components = {
  h1: ({ children }) => (
    <AnchoredHeading
      level="h1"
      className="text-fg-base mt-12 mb-4 text-3xl font-semibold first:mt-0"
    >
      {children}
    </AnchoredHeading>
  ),
  h2: ({ children }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-10 mb-3 text-2xl font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h3: ({ children }) => (
    <AnchoredHeading
      level="h3"
      className="text-fg-base mt-6 mb-2 text-lg font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h4: ({ children }) => (
    <AnchoredHeading
      level="h4"
      className="text-fg-base mt-4 mb-2 text-base font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  p: ({ children }) => (
    <p className="text-fg-muted my-4 leading-relaxed">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="text-fg-muted my-4 list-disc space-y-1.5 pl-6 [&_ol]:my-1 [&_ul]:my-1 [&_ul]:list-[circle] [&_ul_ul]:list-[square]">
      {children}
    </ul>
  ),
  ol: ({ children, start }: ComponentPropsWithoutRef<'ol'>) => (
    <ol
      start={start}
      className="text-fg-muted my-4 list-decimal space-y-1.5 pl-6 [&_ol]:my-1 [&_ol]:list-[lower-alpha] [&_ol_ol]:list-[lower-roman] [&_ul]:my-1"
    >
      {children}
    </ol>
  ),
  li: ({ children, value, className }: ComponentPropsWithoutRef<'li'>) => {
    // `remark-gfm` tags task-list `<li>`s with `task-list-item`. Strip the
    // bullet so the inline checkbox aligns flush with the rest of the list.
    const isTask =
      typeof className === 'string' && className.includes('task-list-item');
    return (
      <li
        value={value}
        className={
          isTask
            ? '-ml-6 flex list-none items-start gap-2 leading-relaxed [&>input]:mt-1.5'
            : 'leading-relaxed'
        }
      >
        {children}
      </li>
    );
  },
  input: ({
    type,
    checked,
    disabled,
    ...rest
  }: ComponentPropsWithoutRef<'input'>) => {
    if (type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          readOnly
          className="border-border-base text-accent-base focus:ring-accent-base/40 size-4 shrink-0 rounded accent-current"
          {...rest}
        />
      );
    }
    return <input type={type} {...rest} />;
  },
  details: ({ children, ...rest }: ComponentPropsWithoutRef<'details'>) => (
    <details
      className="border-border-base bg-bg-elevated/40 my-4 rounded-lg border px-4 py-3 [&[open]>summary]:mb-2"
      {...rest}
    >
      {children}
    </details>
  ),
  summary: ({ children, ...rest }: ComponentPropsWithoutRef<'summary'>) => (
    <summary
      className="text-fg-base hover:text-fg-base/90 cursor-pointer list-none font-medium select-none [&::-webkit-details-marker]:hidden"
      {...rest}
    >
      {children}
    </summary>
  ),
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => {
    // Render a plain anchor by default — keeps the package router-agnostic
    // so it can run anywhere (Storybook, SSR, non-routed apps). Consumers
    // that want SPA navigation pass their own `components.a` (e.g. a
    // TanStack-Router-aware <Link>) when calling <Markdown>.
    const isExternal =
      typeof href === 'string' &&
      (href.startsWith('http://') || href.startsWith('https://'));
    return (
      <a
        href={href}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        className="text-fg-base underline underline-offset-4 hover:no-underline"
      >
        {children}
      </a>
    );
  },
  strong: ({ children }) => (
    <strong className="text-fg-base font-semibold">{children}</strong>
  ),
  blockquote: ({ children }) => {
    // GFM alerts (`> [!NOTE]`, `> [!WARNING]`, etc.) are parsed by `remark-gfm`
    // as ordinary blockquotes — the marker survives as the first text node of
    // the first paragraph. Detect it here and swap to a styled <Callout>.
    const alert = detectAlert(children);
    if (alert) {
      return <Callout tone={alert.tone}>{alert.rest}</Callout>;
    }
    return (
      <blockquote className="border-accent-base bg-bg-elevated/40 text-fg-base [&_p]:text-fg-base my-6 border-l-4 px-5 py-2">
        {children}
      </blockquote>
    );
  },
  code: ({ children, className }: ComponentPropsWithoutRef<'code'>) => {
    const isBlock =
      typeof className === 'string' && className.includes('language-');
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="bg-bg-elevated text-fg-base rounded px-1.5 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    );
  },
  pre: makePreComponent(),
  hr: () => <hr className="border-border-base my-10" />,
  table: ({ children }) => (
    <div className="border-border-base bg-bg-base relative my-6 max-h-[36rem] overflow-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-bg-elevated sticky top-0 z-10">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="hover:bg-bg-elevated/70 border-border-base border-b transition-colors last:border-b-0">
      {children}
    </tr>
  ),
  th: ({ children, className }: ComponentPropsWithoutRef<'th'>) => (
    <th
      scope="col"
      className={cn(
        'text-fg-base border-border-base border-b px-3 py-2 text-left font-semibold',
        className,
      )}
    >
      {children}
    </th>
  ),
  td: ({ children, className }: ComponentPropsWithoutRef<'td'>) => (
    <td className={cn('text-fg-muted px-3 py-2 align-top', className)}>
      {children}
    </td>
  ),
  img: ({ src, alt }: ComponentPropsWithoutRef<'img'>) => (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      decoding="async"
      className="border-border-base my-6 h-auto max-w-full rounded-lg border"
    />
  ),
};

interface ExtractedCode {
  language: string | undefined;
  text: string;
}

/**
 * Build the `pre` Markdown component. Streaming surfaces pass
 * `{ showLineNumbers: true, streamingMermaid: true }` so code blocks never
 * shift content as new lines arrive and partial mermaid DSL doesn't try to
 * render mid-stream.
 */
export function makePreComponent({
  showLineNumbers,
  streamingMermaid,
}: { showLineNumbers?: boolean; streamingMermaid?: boolean } = {}): NonNullable<
  Components['pre']
> {
  return function Pre({ children }) {
    const child = extractCodeChild(children);
    if (!child) return <pre>{children}</pre>;
    if (child.language === 'mermaid') {
      return <Mermaid chart={child.text} streaming={streamingMermaid} />;
    }
    return (
      <CodeBlock
        code={child.text}
        language={child.language}
        showLineNumbers={showLineNumbers}
      />
    );
  };
}

function extractCodeChild(children: ReactNode): ExtractedCode | null {
  if (!children || typeof children !== 'object') return null;
  // children may be a single element or an array
  const arr = Array.isArray(children) ? children : [children];
  for (const node of arr) {
    if (
      node !== null &&
      typeof node === 'object' &&
      'props' in node &&
      typeof (node as { props: unknown }).props === 'object'
    ) {
      const props = (
        node as { props: { className?: string; children?: ReactNode } }
      ).props;
      const className = props.className ?? '';
      const langMatch = /language-([a-z0-9+-]+)/i.exec(className);
      const text = stringifyChildren(props.children);
      return { language: langMatch?.[1], text };
    }
  }
  return null;
}

function stringifyChildren(children: ReactNode): string {
  if (children === null || children === undefined) return '';
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(stringifyChildren).join('');
  if (typeof children === 'object' && 'props' in children) {
    return stringifyChildren(
      (children as { props: { children?: ReactNode } }).props.children,
    );
  }
  return '';
}

export function Markdown({ children, components, className }: MarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // `rehype-raw` reparses raw HTML embedded in markdown so authored
        // tags like `<CodeGroup>`, `<Note>`, `<Card>` survive as hast nodes
        // and reach the components map below. Without it those tags are
        // dropped silently and only the prose between them renders.
        // `rehypeNumericColumns` walks each table and tags columns whose
        // body cells are all numeric-like with `text-right`, so finance /
        // metric tables read aligned without any author opt-in.
        rehypePlugins={[rehypeRaw, rehypeNumericColumns]}
        components={{ ...baseComponents, ...components }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
