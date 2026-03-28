'use client';

/**
 * IncrementalMarkdown Component
 *
 * Renders streaming markdown content with a typewriter reveal effect.
 * Content is split into two portions for optimal performance:
 *
 * ```
 * [  Stable (complete blocks)  ][  Streaming (last block)  ][  Hidden  ]
 * ^                              ^                           ^          ^
 * 0                         splitPoint                 revealPosition  length
 * ```
 *
 * - **Stable portion**: Complete blocks before the last `\n\n` boundary.
 *   Parsed ONCE and memoized — never re-parsed during animation.
 * - **Streaming portion**: The last in-progress block. Re-parsed per frame
 *   with remendMarkdown to close incomplete syntax.
 *
 * This reduces per-frame parsing from O(revealed_length) to O(last_block_length),
 * typically ~10x faster for long responses.
 */

import type { Components, Options as MarkdownOptions } from 'react-markdown';

import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import type {
  MarkdownComponentMap,
  MarkdownComponentType,
} from '@/lib/utils/markdown-types';

import { findBlockSplitPoint } from '../utils/find-block-split';
import { remendMarkdown } from '../utils/remend-markdown';

const chatSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary'],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), 'open'],
  },
};

const remarkDisableIndentedCode = function (this: {
  data: () => { micromarkExtensions?: { disable?: { null?: string[] } }[] };
}) {
  const data = this.data();
  if (!data.micromarkExtensions) data.micromarkExtensions = [];
  data.micromarkExtensions.push({ disable: { null: ['codeIndented'] } });
};

type PluginList = NonNullable<MarkdownOptions['remarkPlugins']>;

const REMARK_PLUGINS: PluginList = [remarkDisableIndentedCode, remarkGfm];
const REHYPE_PLUGINS: PluginList = [
  rehypeRaw,
  [rehypeSanitize, chatSanitizeSchema],
];

// ============================================================================
// CONSTANTS
// ============================================================================

/** Tags that receive cursor wrappers — used to detect nesting and prevent double cursors */
const CURSOR_ELIGIBLE_TAGS = new Set([
  'p',
  'li',
  'td',
  'th',
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
  /** Custom markdown components */
  components?: MarkdownComponentMap;
  /** Additional CSS class */
  className?: string;
  /** Whether to show the typing cursor */
  showCursor?: boolean;
  /** Whether the content is still being generated */
  'aria-busy'?: boolean;
}

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
    const rawRevealed = content ? content.slice(0, revealedLength) : '';
    const revealedContent = remendMarkdown(rawRevealed);

    // Refs must track the remended string because react-markdown's AST
    // node.position offsets reference positions in the string it received.
    const revealedLenRef = useRef(revealedContent.length);
    revealedLenRef.current = revealedContent.length;
    const revealedTextRef = useRef(revealedContent);
    revealedTextRef.current = revealedContent;

    // Single-cursor guarantee: if the isLastElement heuristic matches
    // multiple elements (rare edge case with trailing whitespace after
    // remendMarkdown), hide all but the last cursor. Runs synchronously
    // after DOM commit but before paint — double cursor is never visible.
    const containerRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const cursors = el.querySelectorAll<HTMLElement>('.animate-cursor-blink');
      if (cursors.length <= 1) return;
      for (let i = 0; i < cursors.length - 1; i++) {
        cursors[i].style.display = 'none';
      }
      return () => {
        for (let i = 0; i < cursors.length - 1; i++) {
          cursors[i].style.display = '';
        }
      };
    }, [revealedLength, showCursor]);

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
        Tag: 'p' | 'li' | 'td' | 'th' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
        CustomComponent?: MarkdownComponentType,
      ) => {
        return function CursorWrapper({
          node,
          children,
          ...props
        }: Record<string, unknown> & {
          node?: {
            position?: {
              start?: { offset?: number };
              end?: { offset?: number };
            };
            children?: { tagName?: string }[];
          };
          children?: ReactNode;
        }) {
          // Skip cursor on parent elements whose block-level children
          // already handle it (e.g. <li> containing <p> in loose lists).
          const hasCursorEligibleChild = node?.children?.some(
            (child) => child.tagName && CURSOR_ELIGIBLE_TAGS.has(child.tagName),
          );

          const startOffset = node?.position?.start?.offset;
          const endOffset = node?.position?.end?.offset;
          const revealedLen = revealedLenRef.current;

          // An element is "current" if the reveal position falls inside it
          // (started but not yet ended). This is the mid-block case that was
          // previously missed: the parser hasn't closed the element yet so
          // endOffset > revealedLen, meaning neither of the completed-element
          // checks below would ever match.
          const isCurrentlyTyping =
            startOffset !== undefined &&
            endOffset !== undefined &&
            startOffset < revealedLen &&
            endOffset > revealedLen;

          // Skip cursor injection into elements whose revealed content is
          // entirely whitespace — e.g. trailing empty <p> from a final \n.
          const hasContent =
            startOffset === undefined ||
            endOffset === undefined ||
            revealedTextRef.current
              .slice(startOffset, Math.min(endOffset, revealedLen))
              .trim() !== '';

          const isLastElement =
            hasContent &&
            !hasCursorEligibleChild &&
            (isCurrentlyTyping ||
              endOffset === revealedLen ||
              (endOffset &&
                revealedTextRef.current.slice(endOffset).trim() === ''));

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
    }, [components, showCursor]);

    if (!revealedContent) return null;

    return (
      <div ref={containerRef}>
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cursor wrapper functions are structurally compatible with react-markdown Components; Index signature mismatch is a false positive
          components={componentsWithCursor as Components}
        >
          {revealedContent}
        </Markdown>
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Re-render when revealed length, content, or cursor state changes
    return (
      prevProps.content === nextProps.content &&
      prevProps.revealedLength === nextProps.revealedLength &&
      prevProps.showCursor === nextProps.showCursor &&
      prevProps.components === nextProps.components
    );
  },
);

// ============================================================================
// STABLE MARKDOWN COMPONENT
// ============================================================================

/**
 * Renders completed markdown blocks. Memoized on content — only re-renders
 * when a new block "graduates" from streaming to stable (infrequent).
 */
const StableMarkdown = memo(
  function StableMarkdown({
    content,
    components,
  }: {
    content: string;
    components?: MarkdownComponentMap;
  }) {
    return (
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as StreamingMarkdown
        components={components as Components}
      >
        {content}
      </Markdown>
    );
  },
  (prevProps, nextProps) =>
    prevProps.content === nextProps.content &&
    prevProps.components === nextProps.components,
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function IncrementalMarkdown({
  content,
  revealPosition,
  components,
  className,
  showCursor,
  'aria-busy': ariaBusy,
}: IncrementalMarkdownProps) {
  const splitIndex = useMemo(
    () => findBlockSplitPoint(content, revealPosition),
    [content, revealPosition],
  );

  const stableContent = splitIndex > 0 ? content.slice(0, splitIndex) : '';
  const streamContent = content.slice(splitIndex);
  const streamRevealLength = revealPosition - splitIndex;

  return (
    <div className={className} aria-busy={ariaBusy}>
      {stableContent && (
        <StableMarkdown content={stableContent} components={components} />
      )}
      {streamContent && (
        <StreamingMarkdown
          content={streamContent}
          revealedLength={streamRevealLength}
          components={components}
          showCursor={showCursor}
        />
      )}
    </div>
  );
}
