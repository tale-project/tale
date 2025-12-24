'use client';

import { useMemo, memo, ComponentType } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface StreamingMarkdownProps {
  content: string;
  isStreaming: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
  components: Record<string, ComponentType<any>>;
  className?: string;
}

/**
 * Split content at the last complete block (paragraph boundary).
 * Returns stable content that can be memoized and streaming content
 * that needs to be re-rendered on each update.
 */
function splitAtLastBlock(text: string): { stable: string; streaming: string } {
  if (!text) return { stable: '', streaming: '' };

  // Find last double newline (paragraph boundary) or code block end
  const lastParagraphEnd = text.lastIndexOf('\n\n');
  const lastCodeBlockEnd = text.lastIndexOf('```\n');

  // Use whichever is later in the text
  const lastBlockEnd = Math.max(lastParagraphEnd, lastCodeBlockEnd);

  // If no good split point found, or split point is too early (< 50% of text),
  // return all as streaming to avoid weird visual splits
  if (lastBlockEnd === -1 || lastBlockEnd < text.length * 0.3) {
    return { stable: '', streaming: text };
  }

  // Ensure we don't split in the middle of a code block
  const stableCandidate = text.slice(0, lastBlockEnd + 1);
  const codeBlockStarts = (stableCandidate.match(/```/g) || []).length;

  // If odd number of ```, we're inside a code block - don't split
  if (codeBlockStarts % 2 !== 0) {
    return { stable: '', streaming: text };
  }

  return {
    stable: stableCandidate,
    streaming: text.slice(lastBlockEnd + 1),
  };
}

/**
 * Memoized component for the stable (completed) portion of content.
 * Only re-renders when the stable content actually changes.
 */
const StableMarkdown = memo(function StableMarkdown({
  content,
  components,
}: {
  content: string;
  // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
  components: Record<string, ComponentType<any>>;
}) {
  if (!content) return null;

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={components}
    >
      {content}
    </Markdown>
  );
});

/**
 * StreamingMarkdown - Optimized markdown rendering for streaming content.
 *
 * When streaming, splits content into:
 * - Stable portion: Complete paragraphs that are memoized and don't re-render
 * - Streaming portion: Current incomplete block that re-renders on each update
 *
 * This dramatically reduces the amount of markdown parsing needed during streaming,
 * improving performance especially for long messages.
 */
export function StreamingMarkdown({
  content,
  isStreaming,
  components,
  className,
}: StreamingMarkdownProps) {
  const { stable, streaming } = useMemo(() => {
    // When not streaming, treat all content as stable (cached)
    if (!isStreaming) {
      return { stable: content, streaming: '' };
    }
    return splitAtLastBlock(content);
  }, [content, isStreaming]);

  return (
    <div className={className}>
      <StableMarkdown content={stable} components={components} />
      {streaming && (
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {streaming}
        </Markdown>
      )}
    </div>
  );
}
