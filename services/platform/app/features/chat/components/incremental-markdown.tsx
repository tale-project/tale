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

import type { Components } from 'react-markdown';

import { memo, useMemo, useRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import type {
  MarkdownComponentMap,
  MarkdownComponentType,
} from '@/lib/utils/markdown-types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Tags that receive cursor wrappers — used to detect nesting and prevent double cursors */
const CURSOR_ELIGIBLE_TAGS = new Set([
  'p',
  'li',
  'td',
  'th',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

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
  /** Custom markdown components */
  components?: MarkdownComponentMap;
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
    components?: MarkdownComponentMap;
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
      className="animate-cursor-blink ml-0.5 inline-block h-[1.1em] w-0.5 bg-current align-text-bottom"
      aria-hidden="true"
    />
  );
});

/**
 * Renders the streaming (incomplete) portion of markdown.
 * Only the revealed slice is parsed; cursor is injected into the last block element.
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
    components?: MarkdownComponentMap;
    showCursor?: boolean;
  }) {
    const revealedContent = content ? content.slice(0, revealedLength) : '';

    // Refs for cursor position detection — avoids recreating wrapper
    // functions on every 50ms update. Wrappers read from refs instead.
    const revealedLenRef = useRef(revealedContent.length);
    revealedLenRef.current = revealedContent.length;
    const revealedTextRef = useRef(revealedContent);
    revealedTextRef.current = revealedContent;

    // Cursor wrapper components — stable across renders (only recreated
    // when showCursor or components change, not on every text update).
    const componentsWithCursor = useMemo(() => {
      if (!showCursor) return components;

      const withCursor = (children: React.ReactNode) => (
        <>
          {children}
          <TypewriterCursor />
        </>
      );

      const createCursorWrapper = (
        Tag:
          | 'p'
          | 'li'
          | 'td'
          | 'th'
          | 'pre'
          | 'h1'
          | 'h2'
          | 'h3'
          | 'h4'
          | 'h5'
          | 'h6',
        CustomComponent?: MarkdownComponentType,
      ) => {
        return function CursorWrapper({
          node,
          children,
          ...props
        }: Record<string, unknown> & {
          node?: {
            position?: { end?: { offset?: number } };
            children?: { tagName?: string }[];
          };
          children?: ReactNode;
        }) {
          // Skip cursor on parent elements whose block-level children
          // already handle it (e.g. <li> containing <p> in loose lists).
          const hasCursorEligibleChild = node?.children?.some(
            (child) => child.tagName && CURSOR_ELIGIBLE_TAGS.has(child.tagName),
          );

          const isLastElement =
            !hasCursorEligibleChild &&
            (node?.position?.end?.offset === revealedLenRef.current ||
              (node?.position?.end?.offset &&
                revealedTextRef.current
                  .slice(node.position.end.offset)
                  .trim() === ''));

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
        pre: createCursorWrapper('pre', components?.pre),
        h1: createCursorWrapper('h1', components?.h1),
        h2: createCursorWrapper('h2', components?.h2),
        h3: createCursorWrapper('h3', components?.h3),
        h4: createCursorWrapper('h4', components?.h4),
        h5: createCursorWrapper('h5', components?.h5),
        h6: createCursorWrapper('h6', components?.h6),
      };
    }, [components, showCursor]);

    if (!revealedContent) return null;

    return (
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cursor wrapper functions are structurally compatible with react-markdown Components; Index signature mismatch is a false positive
        components={componentsWithCursor as Components}
      >
        {revealedContent}
      </Markdown>
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
  components,
  className,
  showCursor,
}: IncrementalMarkdownProps) {
  // Split content at anchor position.
  // Note: we intentionally do NOT consolidate all content into stable when
  // streaming ends. Doing so causes a full markdown re-parse that produces
  // slightly different DOM (e.g. separate lists become a single loose list),
  // which changes the content height and triggers a visible scroll jump.
  // Instead, the split stays at the current anchor — the streaming portion
  // simply loses its cursor, a minimal DOM change with no height impact.
  const { stableContent, streamingContent, streamingRevealLength } =
    useMemo(() => {
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
    }, [content, anchorPosition, revealPosition]);

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
