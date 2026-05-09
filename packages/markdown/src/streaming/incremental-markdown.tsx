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

import { memo, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Components, Options as MarkdownOptions } from 'react-markdown';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { baseComponents } from '../markdown';
import { remarkCjkAttention } from '../plugins/micromark-cjk-attention';
import type { MarkdownComponentMap, MarkdownComponentType } from '../types';
import { findBlockSplitPoint } from './find-block-split';
import { normalizeHtmlBlocks } from './normalize-html-blocks';
import { remendMarkdown } from './remend-markdown';

/**
 * Streaming defaults — the *exact same* component map `<Markdown>` uses,
 * so streaming and static prose render with the same code blocks,
 * headings (with hover-anchor links), tables, callouts, accordions,
 * everything. Caller-provided overrides (chat citations, debounced
 * highlighters) merge on top.
 *
 * Trade-off: keeping the static `<CodeBlock>` for `pre` means Shiki
 * re-tokenises on every reveal step. Storybook + casual streaming live
 * with that; chat callers stream large code blocks via their own
 * debounced highlighter passed through `components`.
 */
const STREAMING_BASE = baseComponents as unknown as MarkdownComponentMap;

const chatSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'cite'],
  attributes: {
    ...defaultSchema.attributes,
    details: [...(defaultSchema.attributes?.details ?? []), 'open'],
    cite: ['data-n'],
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

// Cast through `as PluginList` because `remarkCjkAttention` and
// `remarkDisableIndentedCode` use narrowed `this`-types for type-safe
// data() access — narrower than unified's `Plugin` signature, but
// structurally compatible at runtime.
const REMARK_PLUGINS: PluginList = [
  remarkDisableIndentedCode,
  remarkCjkAttention,
  remarkGfm,
] as PluginList;
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
// AST HELPERS
// ============================================================================

/**
 * Minimal HAST node shape used by the cursor wrapper. react-markdown v10
 * passes full HAST nodes to component overrides; we only need a subset.
 */
type HastNode = {
  type?: 'element' | 'text' | 'raw' | 'comment' | 'root';
  value?: string;
  tagName?: string;
  children?: HastNode[];
};

/**
 * Returns true if the node (or any descendant) contains an actual text node
 * with non-whitespace content.
 *
 * The cursor selection logic needs to skip elements that exist in the AST
 * but produce no rendered text — empty `<li>` from a trailing `\n- `,
 * empty `<blockquote>` from `\n> `, empty heading from `\n# `, etc. The
 * old slice-trim heuristic missed these because the source slice contained
 * the marker character (`"- "` trims to `"-"`, truthy). This walks the
 * actual AST instead, which is the authoritative answer.
 *
 * String.prototype.trim() is Unicode-whitespace-aware per ECMA-262, so
 * full-width space U+3000 / NBSP / etc. in CJK content are correctly
 * treated as empty. ZWSP / ZWJ are not whitespace and correctly count
 * as content. Comment nodes (which carry `value`) are excluded by the
 * `text|raw` type guard, and rehypeSanitize strips them upstream anyway.
 */
function hasRenderedText(node: HastNode | undefined): boolean {
  if (!node) return false;
  if (node.type === 'text' || node.type === 'raw') {
    return (node.value ?? '').trim() !== '';
  }
  if (node.children) {
    for (const child of node.children) {
      if (hasRenderedText(child)) return true;
    }
  }
  return false;
}

/**
 * Lines that consist entirely of a block-level marker (`-`, `*`, `+`,
 * ordered-list digit + `.` or `)`, `>`, `#`–`######`, or `|`) followed by
 * optional whitespace. Used to ignore trailing marker-only lines when
 * deciding "is there more rendered content past this element".
 */
const ONLY_BLOCK_MARKER_LINE_RE =
  /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)]|>|#{1,6}|\|)[ \t]*$/;

/**
 * Returns true if the given source-text slice would render any visible text
 * past the current element. The naive `slice.trim() === ''` check fails for
 * trailing markers like `\n- ` (trims to `-`, truthy) — the cursor wrapper
 * then thinks there's more content ahead and refuses to mark this element
 * as the last cursor target. By treating marker-only lines as no-content
 * (matching `hasRenderedText`'s AST view), the cursor correctly lands in
 * the last element with actual text.
 */
function hasRenderedTextRemaining(text: string): boolean {
  if (!text || !text.trim()) return false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (ONLY_BLOCK_MARKER_LINE_RE.test(line)) continue;
    return true;
  }
  return false;
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
    // normalizeHtmlBlocks runs first so block-level HTML tags get the blank
    // lines CommonMark needs to parse markdown inside them; remendMarkdown
    // then closes any incomplete syntax for stable mid-stream rendering.
    const revealedContent = remendMarkdown(normalizeHtmlBlocks(rawRevealed));

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
      if (!el) return undefined;
      const cursors = el.querySelectorAll<HTMLElement>('.animate-cursor-blink');
      if (cursors.length <= 1) return undefined;
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
          node?: HastNode & {
            position?: {
              start?: { offset?: number };
              end?: { offset?: number };
            };
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

          // Skip cursor injection into elements with no rendered text. The
          // old slice-trim heuristic mistook markers like `\n- ` (trims to
          // `-`, truthy) for content, dropping the cursor into an empty
          // `<li>`. Walking the AST text nodes is the authoritative answer
          // and covers all marker-only-element cases (`<li>`, `<blockquote>`,
          // headings, table cells) in one place.
          const hasContent = hasRenderedText(node);

          const isLastElement =
            hasContent &&
            !hasCursorEligibleChild &&
            (isCurrentlyTyping ||
              endOffset === revealedLen ||
              (endOffset !== undefined &&
                !hasRenderedTextRemaining(
                  revealedTextRef.current.slice(endOffset),
                )));

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
    // Same normalization as StreamingMarkdown — block-level HTML tags need
    // surrounding blank lines for CommonMark to parse markdown inside them.
    const normalized = normalizeHtmlBlocks(content);
    return (
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same as StreamingMarkdown
        components={components as Components}
      >
        {normalized}
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

  // Default to the streaming-safe base map so streaming prose looks the
  // same as static `<Markdown>` (paragraphs, lists, links, tables,
  // blockquotes, plain headings). Caller-provided overrides — chat's
  // citation/code-block wrappers — merge on top.
  const merged = useMemo<MarkdownComponentMap>(
    () => ({ ...STREAMING_BASE, ...components }),
    [components],
  );

  return (
    <div className={className} aria-busy={ariaBusy}>
      {stableContent && (
        <StableMarkdown content={stableContent} components={merged} />
      )}
      {streamContent && (
        <StreamingMarkdown
          content={streamContent}
          revealedLength={streamRevealLength}
          components={merged}
          showCursor={showCursor}
        />
      )}
    </div>
  );
}
