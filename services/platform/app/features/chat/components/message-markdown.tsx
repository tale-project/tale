'use client';

/**
 * An assistant message's content.
 *
 * ONE renderer for every state: the text always renders through the
 * typewriter — a live row reveals as it streams, a settled row takes the
 * incremental renderer's settled fast path (fully revealed, single stable
 * parse). Stream → settled is therefore a prop change on one component
 * instance, never a component swap: the DOM persists and the buffered tail
 * drains smoothly instead of popping.
 *
 * The streamed text arrives as its own prop: while a turn is live it comes
 * from the generation row's stream channel, not from `parts` (which stay
 * empty until the finalize write). Non-text parts render after the text as
 * their usual chips — except tool calls and results, which belong to the
 * thought timeline above the answer.
 */

import { useMemo } from 'react';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { TypewriterText } from '@/app/features/shared/markdown/typewriter-text';
import { cn } from '@/lib/utils/cn';

import type { MessagePart } from '../types';
import { MessageParts } from './message-parts';

export function MessageMarkdown({
  text,
  parts,
  isStreaming,
  onRevealComplete,
  onFirstReveal,
}: {
  /** The message's plain text — the in-flight streamed text on a live row. */
  text: string;
  parts: readonly MessagePart[];
  /** True while the live turn streams into this message. */
  isStreaming: boolean;
  /** Fires when the buffered reveal reaches the end of the settled text. */
  onRevealComplete?: () => void;
  /** Fires once when the typewriter first paints a glyph. */
  onFirstReveal?: () => void;
}) {
  // Models sometimes emit doubled pipes in GFM table rows; collapsing them
  // before the parse keeps the table a table instead of sprouting empty
  // columns. Blanket, like 0.3 shipped it.
  const displayText = useMemo(() => text.replace(/\|\|+/g, '|'), [text]);
  const extras = parts.filter(
    (part) =>
      part.type !== 'text' &&
      part.type !== 'reasoning' &&
      part.type !== 'tool-call' &&
      part.type !== 'tool-result',
  );
  return (
    <>
      {displayText.length > 0 && (
        <TypewriterText
          text={displayText}
          isStreaming={isStreaming}
          components={markdownComponents}
          className={cn('text-sm', markdownWrapperStyles)}
          {...(onRevealComplete !== undefined
            ? { onComplete: onRevealComplete }
            : {})}
          {...(onFirstReveal !== undefined ? { onFirstReveal } : {})}
        />
      )}
      {extras.length > 0 && <MessageParts parts={extras} />}
    </>
  );
}
