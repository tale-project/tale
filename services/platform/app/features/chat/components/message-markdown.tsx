'use client';

/**
 * An assistant message's content.
 *
 * A settled message renders each part in authored order with its text parts
 * as markdown. The message the live turn streams into renders through the
 * typewriter instead — buffered reveal over incremental markdown — so the
 * reply reads as writing, not repainting. Once a message has streamed in this
 * mount it stays on the typewriter (with `isStreaming` off) so the buffered
 * tail drains smoothly instead of popping when the generation row disappears.
 *
 * The streamed text arrives as its own prop: while a turn is live it comes
 * from the generation row's stream channel, not from `parts` (which stay
 * empty until the finalize write).
 */

import { useRef } from 'react';

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
}: {
  /** The message's plain text — the in-flight streamed text on a live row. */
  text: string;
  parts: readonly MessagePart[];
  /** True while the live turn streams into this message. */
  isStreaming: boolean;
}) {
  const sawStream = useRef(false);
  if (isStreaming) sawStream.current = true;

  if (sawStream.current) {
    return (
      <TypewriterText
        text={text}
        isStreaming={isStreaming}
        components={markdownComponents}
        className={cn('text-sm', markdownWrapperStyles)}
      />
    );
  }
  return <MessageParts parts={parts} markdown />;
}
