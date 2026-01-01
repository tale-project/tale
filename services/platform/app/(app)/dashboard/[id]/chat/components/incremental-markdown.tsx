'use client';

/**
 * IncrementalMarkdown Component
 *
 * Optimized markdown rendering for streaming content. Splits text into
 * stable and streaming portions to minimize re-parsing overhead.
 *
 * STRATEGY:
 * =========
 * 1. STABLE PORTION (before anchorPosition):
 *    - Complete markdown blocks (paragraphs, code blocks, etc.)
 *    - Fully parsed once and memoized
 *    - Never re-rendered during streaming
 *
 * 2. STREAMING PORTION (anchorPosition to revealPosition):
 *    - Current incomplete block being typed
 *    - Re-parsed on each update, but content is small
 *    - Uses CSS mask for smooth character reveal
 *
 * 3. HIDDEN PORTION (after revealPosition):
 *    - Text that hasn't been revealed yet
 *    - Not rendered at all (saves parsing overhead)
 *
 * WHY THIS MATTERS:
 * =================
 * Markdown parsing (especially with GFM tables, code blocks, etc.) is
 * expensive. For a 1000-character response, without splitting:
 * - Every frame: Parse all 1000 characters
 * - Total: 60 parses/second × response_duration
 *
 * With splitting:
 * - Stable portion: Parsed once when anchor advances
 * - Streaming portion: Parse only ~50-100 characters per frame
 * - Total: Much less work, smoother animation
 *
 * ANCHOR ADVANCEMENT:
 * ===================
 * The anchor position advances when the reveal reaches a "safe" boundary:
 * - After a double newline (paragraph end)
 * - After a code block closing (```)
 * - Never inside a code block or incomplete syntax
 *
 * This ensures the stable portion is always valid markdown that won't
 * change structure as more text arrives.
 */

import { memo, useMemo, type ComponentType } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

// ============================================================================
// TYPES
// ============================================================================

interface IncrementalMarkdownProps {
  /** The full content to render */
  content: string;
  /** Current reveal position (characters shown) */
  revealPosition: number;
  /** Safe anchor position for splitting (at a block boundary) */
  anchorPosition: number;
  /** Whether content is still streaming */
  isStreaming: boolean;
  /** Custom markdown components */
  // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
  components?: Record<string, ComponentType<any>>;
  /** Additional CSS class */
  className?: string;
}

// ============================================================================
// STABLE MARKDOWN COMPONENT
// ============================================================================

/**
 * Renders the stable (complete) portion of markdown.
 * Memoized to prevent re-rendering during streaming.
 */
const StableMarkdown = memo(
  function StableMarkdown({
    content,
    components,
  }: {
    content: string;
    // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
    components?: Record<string, ComponentType<any>>;
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
  },
  (prevProps, nextProps) => {
    // Only re-render if content actually changed
    return prevProps.content === nextProps.content;
  },
);

// ============================================================================
// STREAMING MARKDOWN COMPONENT
// ============================================================================

/**
 * Renders the streaming (incomplete) portion of markdown.
 * Uses CSS mask for smooth character reveal animation.
 */
const StreamingMarkdown = memo(
  function StreamingMarkdown({
    content,
    revealedLength,
    components,
  }: {
    content: string;
    revealedLength: number;
    // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
    components?: Record<string, ComponentType<any>>;
  }) {
    if (!content) return null;

    // Only parse and render the revealed portion
    // This keeps parsing work minimal during animation
    const revealedContent = content.slice(0, revealedLength);

    return (
      <div className="streaming-text-reveal">
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={components}
        >
          {revealedContent}
        </Markdown>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Re-render when revealed length changes
    // (content changes are handled by parent via anchorPosition)
    return (
      prevProps.content === nextProps.content &&
      prevProps.revealedLength === nextProps.revealedLength
    );
  },
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * IncrementalMarkdown splits streaming content into stable and streaming
 * portions for optimal rendering performance.
 *
 * Architecture:
 * ```
 * [  Stable Content  ][  Streaming Content  ][  Hidden  ]
 * ^                   ^                      ^          ^
 * 0            anchorPosition          revealPosition  length
 * ```
 *
 * - Stable: Memoized, parsed once
 * - Streaming: Small, re-parsed on updates
 * - Hidden: Not rendered
 */
export function IncrementalMarkdown({
  content,
  revealPosition,
  anchorPosition,
  isStreaming,
  components,
  className,
}: IncrementalMarkdownProps) {
  // Split content at anchor position
  const { stableContent, streamingContent, streamingRevealLength } =
    useMemo(() => {
      // When not streaming, treat all content as stable
      if (!isStreaming) {
        return {
          stableContent: content,
          streamingContent: '',
          streamingRevealLength: 0,
        };
      }

      // Ensure anchor doesn't exceed reveal position
      const effectiveAnchor = Math.min(anchorPosition, revealPosition);

      // Split at anchor
      const stable = content.slice(0, effectiveAnchor);
      const streaming = content.slice(effectiveAnchor, content.length);

      // Calculate how much of streaming content is revealed
      const revealedInStreaming = Math.max(0, revealPosition - effectiveAnchor);

      return {
        stableContent: stable,
        streamingContent: streaming,
        streamingRevealLength: revealedInStreaming,
      };
    }, [content, anchorPosition, revealPosition, isStreaming]);

  return (
    <div className={className}>
      {/* Stable portion - memoized, parsed once */}
      {stableContent && (
        <StableMarkdown content={stableContent} components={components} />
      )}

      {/* Streaming portion - small, re-parsed on updates */}
      {streamingContent && (
        <StreamingMarkdown
          content={streamingContent}
          revealedLength={streamingRevealLength}
          components={components}
        />
      )}
    </div>
  );
}
