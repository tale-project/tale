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
import rehypeSanitize from 'rehype-sanitize';

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
  /** Whether to show the typing cursor */
  showCursor?: boolean;
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
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
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
 * Animated cursor that appears during typing.
 * Uses CSS animation for smooth blinking without JS overhead.
 */
const TypewriterCursor = memo(function TypewriterCursor() {
  return (
    <span
      className="inline-block w-0.5 h-[1.1em] bg-current ml-0.5 align-text-bottom animate-cursor-blink"
      aria-hidden="true"
    />
  );
});

/**
 * Renders the streaming (incomplete) portion of markdown.
 * Uses CSS mask for smooth character reveal animation.
 */
const StreamingMarkdown = memo(
  function StreamingMarkdown({
    content,
    revealedLength,
    components,
    showCursor,
  }: {
    content: string;
    revealedLength: number;
    // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
    components?: Record<string, ComponentType<any>>;
    showCursor?: boolean;
  }) {
    const revealedContent = content ? content.slice(0, revealedLength) : '';

    // Create components that inject cursor at the end of the last element
    // We track render order and append cursor to the last rendered block element
    const componentsWithCursor = useMemo(() => {
      if (!showCursor) return components;

      // Helper to wrap children with cursor at the end
      const withCursor = (children: React.ReactNode) => (
        <>
          {children}
          <TypewriterCursor />
        </>
      );

      // Create wrapper components for block elements that might be last
      const createCursorWrapper = (
        Tag: 'p' | 'li' | 'td' | 'th' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
        // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
        CustomComponent?: ComponentType<any>,
      ) => {
        // biome-ignore lint/suspicious/noExplicitAny: Required for react-markdown component types
        return function CursorWrapper({ node, children, ...props }: any) {
          // Check if this is the last element by looking at node position
          const isLastElement =
            node?.position?.end?.offset === revealedContent.length ||
            // Fallback: check if we're near the end (within whitespace)
            (node?.position?.end?.offset &&
              revealedContent.slice(node.position.end.offset).trim() === '');

          if (CustomComponent) {
            return (
              <CustomComponent {...props}>
                {isLastElement ? withCursor(children) : children}
              </CustomComponent>
            );
          }

          const Element = Tag;
          return (
            <Element {...props}>
              {isLastElement ? withCursor(children) : children}
            </Element>
          );
        };
      };

      return {
        ...components,
        p: createCursorWrapper('p', components?.p),
        li: createCursorWrapper('li', components?.li),
        td: createCursorWrapper('td', components?.td),
        th: createCursorWrapper('th', components?.th),
        h1: createCursorWrapper('h1', components?.h1),
        h2: createCursorWrapper('h2', components?.h2),
        h3: createCursorWrapper('h3', components?.h3),
        h4: createCursorWrapper('h4', components?.h4),
        h5: createCursorWrapper('h5', components?.h5),
        h6: createCursorWrapper('h6', components?.h6),
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only need length for cursor position
    }, [components, showCursor, revealedContent.length]);

    if (!content) return null;

    return (
      <div className="streaming-text-container">
        {/* Hidden layer: Full content establishes layout dimensions */}
        <div className="streaming-text-layout-reference" aria-hidden="true">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSanitize]}
            components={components}
          >
            {content}
          </Markdown>
        </div>

        {/* Visible layer: Revealed content overlaid on top */}
        <div className="streaming-text-reveal">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw, rehypeSanitize]}
            components={componentsWithCursor}
          >
            {revealedContent}
          </Markdown>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Re-render when revealed length, content, or cursor state changes
    return (
      prevProps.content === nextProps.content &&
      prevProps.revealedLength === nextProps.revealedLength &&
      prevProps.showCursor === nextProps.showCursor
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
  showCursor,
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
          showCursor={showCursor}
        />
      )}
    </div>
  );
}
