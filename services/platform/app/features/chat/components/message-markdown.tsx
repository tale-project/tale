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
 *
 * A model sometimes writes a file it made into its text, by the reference
 * its tool answered with: `![chart](s3:…)` or `[report.docx](s3:…)`. The
 * reply's own files already show under it, so such an image is not drawn
 * again; a link opens the file's preview, as its card would; and a stored
 * file the reply does not carry is drawn or opened only when the reader may
 * open it (`stored-files-context.ts`).
 */

import { cn } from '@tale/ui/cn';
import { useMemo, useState } from 'react';

import { DocumentPreviewDialog } from '@/app/features/documents/components/document-preview-dialog-lazy';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/shared/markdown/markdown-renderer';
import {
  type MarkdownStoredFiles,
  MarkdownStoredFilesContext,
  STORAGE_REF_PROTOCOLS,
} from '@/app/features/shared/markdown/stored-files-context';
import { TypewriterText } from '@/app/features/shared/markdown/typewriter-text';

import type { MessagePart } from '../types';
import { artifactsOf } from './message-artifacts';
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
  const [opened, setOpened] = useState<{ ref: string; name: string } | null>(
    null,
  );
  const ownKey = artifactsOf(parts)
    .map((artifact) => artifact.fileId)
    .join('\n');
  const storedFiles = useMemo<MarkdownStoredFiles>(
    () => ({
      own: new Set(ownKey === '' ? [] : ownKey.split('\n')),
      open: setOpened,
    }),
    [ownKey],
  );
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
        <MarkdownStoredFilesContext.Provider value={storedFiles}>
          <TypewriterText
            text={displayText}
            isStreaming={isStreaming}
            components={markdownComponents}
            className={cn('text-sm', markdownWrapperStyles)}
            urlProtocols={STORAGE_REF_PROTOCOLS}
            {...(onRevealComplete !== undefined
              ? { onComplete: onRevealComplete }
              : {})}
            {...(onFirstReveal !== undefined ? { onFirstReveal } : {})}
          />
        </MarkdownStoredFilesContext.Provider>
      )}
      {opened !== null && (
        <DocumentPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setOpened(null);
          }}
          fileId={opened.ref}
          fileName={opened.name}
        />
      )}
      {extras.length > 0 && <MessageParts parts={extras} />}
    </>
  );
}
