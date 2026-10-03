import { cn } from '@tale/ui/cn';
import { AnchoredHeading } from '@tale/ui/markdown/anchored-heading';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents: Components = {
  h1: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-12 mb-4 text-2xl font-semibold first:mt-0"
    >
      {children}
    </AnchoredHeading>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h2"
      className="text-fg-base mt-10 mb-3 text-xl font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h3"
      className="text-fg-base mt-6 mb-2 text-lg font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <AnchoredHeading
      level="h4"
      className="text-fg-base mt-4 mb-2 text-base font-semibold"
    >
      {children}
    </AnchoredHeading>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="text-fg-muted my-4 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="text-fg-muted my-4 list-disc space-y-1.5 pl-6">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="text-fg-muted my-4 list-decimal space-y-1.5 pl-6">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      className="text-fg-base decoration-border-strong hover:decoration-fg-base rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      {children}
    </a>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="text-fg-base font-semibold">{children}</strong>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="border-accent-base bg-bg-elevated/40 text-fg-base [&_p]:text-fg-base my-6 border-l-4 px-5 py-2">
      {children}
    </blockquote>
  ),
  code: ({ children, className }: ComponentPropsWithoutRef<'code'>) => {
    const isBlock =
      typeof className === 'string' && className.includes('language-');
    if (isBlock) {
      return <code className={`${className} text-sm`}>{children}</code>;
    }
    return (
      <code className="bg-bg-elevated text-fg-base rounded px-1.5 py-0.5 font-mono text-[0.875em]">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="bg-bg-elevated my-6 overflow-x-auto rounded-md p-4">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-border-base my-10" />,
  table: ({ children }: { children?: ReactNode }) => (
    <div className="my-6 overflow-x-auto">
      <table className="border-border-base w-full border-collapse border text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border-border-base bg-bg-elevated text-fg-base border px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border-border-base text-fg-muted border px-3 py-2 align-top">
      {children}
    </td>
  ),
};

/** One Markdown treatment for marketing guides and legal pages. Raw HTML stays disabled. */
export function MarketingProse({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 [overflow-wrap:anywhere]', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
