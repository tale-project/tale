'use client';

/**
 * Pack-authored copy (view/block descriptions, the Text/Alert/Card blocks)
 * rendered as Markdown instead of a collapsed single-line literal: GFM plus
 * the task-comment heading density, with lone newlines as hard breaks —
 * pack JSON authors write `\n` to mean a visible break, not a soft wrap.
 * Deliberately NO `rehype-raw`: embedded HTML stays escaped text, so a pack
 * string can never inject markup into the platform UI.
 */
import { textVariants, type TextVariant } from '@tale/ui/text';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { markdownWrapperStyles } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { cn } from '@/lib/utils/cn';

/** Lone `\n` → markdown hard break (`"  \n"`); blank-line paragraphs pass through. */
function withHardBreaks(text: string): string {
  return text.replaceAll(/(?<!\n)\n(?!\n)/g, '  \n');
}

export function PackMarkdown({
  text,
  variant,
  className,
}: {
  text: string;
  /** Typography preset from `@tale/ui` Text; omit to inherit the surrounding
   *  colour/size (e.g. inside an Alert's tinted description slot). */
  variant?: TextVariant;
  className?: string;
}) {
  return (
    <div
      className={cn(
        variant !== undefined && textVariants({ variant }),
        markdownWrapperStyles,
        // Description density — chat h1/h2 sizes are too loud here (same
        // clamp as task-comment mention-text).
        '[&_h1]:mt-2 [&_h1]:text-base [&_h2]:mt-2 [&_h2]:text-sm [&_h3]:mt-2 [&_h3]:text-sm',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {withHardBreaks(text)}
      </ReactMarkdown>
    </div>
  );
}
