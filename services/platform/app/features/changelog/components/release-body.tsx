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
export function ReleaseBody({ html, className }: ReleaseBodyProps) {
  const safe = useMemo(() => DOMPurify.sanitize(html), [html]);
  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none',
        'prose-a:text-fg-base prose-a:underline prose-a:underline-offset-2',
        className,
      )}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
