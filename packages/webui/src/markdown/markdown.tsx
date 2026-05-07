import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { AnchoredHeading } from './anchored-heading';
import { CodeBlock } from './code-block';
import { Mermaid } from './components/mermaid';

interface MarkdownProps {
  children: string;
  /** Override or extend the component map. */
  components?: Components;
  className?: string;
}

const baseComponents: Components = {
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
    <ul className="text-fg-muted my-4 list-disc space-y-1.5 pl-6">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-fg-muted my-4 list-decimal space-y-1.5 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-fg-base underline underline-offset-4 hover:no-underline"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="text-fg-base font-semibold">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-accent-base bg-bg-elevated/40 text-fg-base [&_p]:text-fg-base my-6 border-l-4 px-5 py-2">
      {children}
    </blockquote>
  ),
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
  pre: ({ children }) => {
    // Pull the inner <code> element to extract language + raw text so we can
    // hand it to <CodeBlock> for Shiki highlighting + the copy button. Code
    // blocks tagged `mermaid` go through the <Mermaid> renderer instead.
    const child = extractCodeChild(children);
    if (!child) return <pre>{children}</pre>;
    if (child.language === 'mermaid') return <Mermaid chart={child.text} />;
    return <CodeBlock code={child.text} language={child.language} />;
  },
  hr: () => <hr className="border-border-base my-10" />,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto">
      <table className="border-border-base w-full border-collapse border text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => (
    <tbody className="[&>tr:hover]:bg-bg-elevated/60 [&>tr]:transition-colors">
      {children}
    </tbody>
  ),
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => (
    <th className="border-border-base bg-bg-elevated text-fg-base border px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border-base text-fg-muted border px-3 py-2 align-top">
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
        components={{ ...baseComponents, ...components }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
