'use client';

import DOMPurify from 'dompurify';
import { useMemo } from 'react';

import { cn } from '@/lib/utils/cn';

interface ReleaseBodyProps {
  html: string;
  className?: string;
}

// GitHub serves rendered HTML for release notes; we render it as-is via
// dangerouslySetInnerHTML after sanitising on the client. The shared
// `<Markdown>` component would re-parse this through remark-gfm and
// distort the output (callouts, autolinks, code blocks), so we bypass it.
// Styling: this monorepo does not load `@tailwindcss/typography`, so
// `prose` is a no-op and Tailwind preflight strips heading / list defaults.
// Style each element explicitly via arbitrary descendant selectors — same
// pattern used in `collapsible-message.tsx` / `message-list.tsx`.
export function ReleaseBody({ html, className }: ReleaseBodyProps) {
  const safe = useMemo(() => DOMPurify.sanitize(html), [html]);
  return (
    <div
      className={cn(
        'text-fg-muted max-w-none text-sm leading-relaxed',
        '[&_h1]:text-fg-base [&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:first:mt-0',
        '[&_h2]:text-fg-base [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:first:mt-0',
        '[&_h3]:text-fg-base [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_h4]:text-fg-base [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-medium',
        '[&_p]:my-2',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5',
        '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5',
        '[&_li]:leading-relaxed [&_li>p]:my-0',
        '[&_a]:text-fg-base [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:no-underline',
        '[&_strong]:text-fg-base [&_strong]:font-semibold',
        '[&_em]:italic',
        '[&_code]:bg-bg-elevated [&_code]:text-fg-base [&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
        '[&_pre]:bg-bg-elevated [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:text-xs',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em]',
        '[&_blockquote]:border-border-base [&_blockquote]:text-fg-subtle [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:pl-3',
        '[&_hr]:border-border-base [&_hr]:my-4',
        '[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded',
        '[&_table]:my-3 [&_table]:w-full [&_table]:text-sm',
        '[&_th]:text-fg-base [&_th]:border-border-base [&_th]:border-b [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border-border-base [&_td]:border-b [&_td]:px-2 [&_td]:py-1.5',
        className,
      )}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
