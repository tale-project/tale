import { cn } from '@tale/ui/cn';
import type { ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ReleaseBodyProps {
  /** GitHub-flavoured Markdown from the Releases API. */
  markdown: string;
  className?: string;
}

const proseClass = cn(
  'text-fg-muted max-w-none text-[15px] leading-relaxed md:text-base',
  // Release notes often open with `# title` — demote so the page keeps a
  // single document H1 (changelog hero). Styles match the demoted tags.
  '[&_h2]:text-fg-base [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-[-0.02em] [&_h2]:first:mt-0',
  '[&_h3]:text-fg-base [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:first:mt-0',
  '[&_h4]:text-fg-base [&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold',
  '[&_p]:my-2.5',
  '[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5',
  '[&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5',
  '[&_li]:leading-relaxed [&_li>p]:my-0',
  '[&_a]:text-fg-base [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline',
  '[&_strong]:text-fg-base [&_strong]:font-semibold',
  '[&_code]:bg-surface-site-inset [&_code]:text-fg-base [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:bg-surface-site-inset [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs',
  '[&_hr]:border-border-base [&_hr]:my-4',
);

type MdHeadingProps = ComponentPropsWithoutRef<'h2'>;

/** Drop the trailing GitHub "Full Changelog" compare footer. */
export function stripFullChangelogFooter(markdown: string): string {
  return markdown
    .replace(/\n{0,2}\*{0,2}Full Changelog\*{0,2}\s*:\s*\S+\s*$/i, '')
    .trimEnd();
}

/**
 * Marketing release notes — Markdown from the GitHub API via remark-gfm.
 * No `rehype-raw`, so HTML in bodies is not executed. Links open in a new tab.
 * Heading levels are demoted by one so release `#` / `##` never compete with
 * the page H1 (SEO + a11y: one document outline root).
 */
export function ReleaseBody({ markdown, className }: ReleaseBodyProps) {
  const cleaned = stripFullChangelogFooter(markdown);

  return (
    <div className={cn(proseClass, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          h1: ({ children, ...props }: MdHeadingProps) => (
            <h2 {...props}>{children}</h2>
          ),
          h2: ({ children, ...props }: MdHeadingProps) => (
            <h3 {...props}>{children}</h3>
          ),
          h3: ({ children, ...props }: MdHeadingProps) => (
            <h4 {...props}>{children}</h4>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
