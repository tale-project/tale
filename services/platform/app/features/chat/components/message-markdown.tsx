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
 */

import { useRef } from 'react';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import { TypewriterText } from '@/app/features/shared/markdown/typewriter-text';
import { cn } from '@/lib/utils/cn';

import { messagePlainText } from '../lib/message-text';
import type { MessagePart } from '../types';
import { MessageParts } from './message-parts';

export function MessageMarkdown({
  parts,
  isStreaming,
}: {
  parts: readonly MessagePart[];
  /** True while the live turn streams into this message. */
  isStreaming: boolean;
}) {
  const sawStream = useRef(false);
  if (isStreaming) sawStream.current = true;

  if (sawStream.current) {
    return (
      <TypewriterText
        text={messagePlainText(parts)}
        isStreaming={isStreaming}
        components={markdownComponents}
        className={cn('text-sm', markdownWrapperStyles)}
      />
    );
  }
  return <MessageParts parts={parts} markdown />;
}
