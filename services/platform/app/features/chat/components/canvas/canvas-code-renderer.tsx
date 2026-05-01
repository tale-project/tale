'use client';

import { memo, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode } from '@/lib/utils/shiki';

interface CanvasCodeRendererProps {
  code: string;
  language?: string;
  isEditing: boolean;
  /** True only while the LLM is actively appending tokens (create/rewrite).
   * Drives the trailing caret and stick-to-bottom; patch streams keep this
   * false because the source is unchanged during the stream window. */
  isStreaming?: boolean;
  /** When provided (patch streams), each entry pairs the model's `search`
   * snippet with its (potentially still-streaming) `replace`. The renderer
   * locates the search in the source and renders a strikethrough + insert
   * preview so the user sees the diff that is about to land. */
  highlightPatches?: readonly { search: string; replace: string }[];
  onContentChange: (content: string) => void;
}

/** Pixel tolerance for considering the pre "at the bottom". Mirrors the
 * inline code-block in message-bubble so the two feel consistent. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

interface DiffRange {
  start: number;
  end: number;
  replace: string;
}

/**
 * Render the source with each patch's `search` block struck through and the
 * incoming `replace` text shown alongside as an addition. Plain-text
 * rendering — used during patch streams in lieu of shiki, since shiki HTML
 * cannot host overlay marks without re-tokenising. The trade-off (no syntax
 * colour for a few seconds) is worth the explicit "this becomes that"
 * signal. When `replace` is still empty (model mid-typing the replacement)
 * we render only the strikethrough; the addition appears once any
 * replacement text arrives.
 */
function renderWithDiff(
  code: string,
  patches: readonly { search: string; replace: string }[],
): ReactNode[] {
  const ranges: DiffRange[] = [];
  for (const patch of patches) {
    if (!patch.search) continue;
    const idx = code.indexOf(patch.search);
    if (idx === -1) continue;
    const start = idx;
    const end = idx + patch.search.length;
    // Skip overlap with an already-claimed range. First-write-wins keeps
    // the visualisation deterministic when search snippets happen to nest.
    const overlaps = ranges.some((r) => !(end <= r.start || start >= r.end));
    if (!overlaps) ranges.push({ start, end, replace: patch.replace });
  }
  if (ranges.length === 0) return [code];
  ranges.sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    if (cursor < r.start) parts.push(code.slice(cursor, r.start));
    parts.push(
      <del
        key={`del-${r.start}`}
        className="bg-destructive/15 text-destructive/90 decoration-destructive/60 rounded-sm decoration-2"
      >
        {code.slice(r.start, r.end)}
      </del>,
    );
    if (r.replace.length > 0) {
      parts.push(
        <ins
          key={`ins-${r.start}`}
          className="bg-success/15 text-success-foreground rounded-sm px-0.5 no-underline"
        >
          {r.replace}
        </ins>,
      );
    }
    cursor = r.end;
  }
  if (cursor < code.length) parts.push(code.slice(cursor));
  return parts;
}

function CanvasCodeRendererComponent({
  code,
  language = 'plaintext',
  isEditing,
  isStreaming = false,
  highlightPatches,
  onContentChange,
}: CanvasCodeRendererProps) {
  const { t } = useT('chat');
  const [html, setHtml] = useState('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (isEditing) return undefined;
    let cancelled = false;
    void highlightCode(code, language, shikiTheme).then((result) => {
      if (!cancelled && result) {
        setHtml(extractShikiCodeContent(result));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, shikiTheme, isEditing]);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return undefined;
    const onScroll = () => {
      const distanceFromBottom =
        pre.scrollHeight - pre.scrollTop - pre.clientHeight;
      stickToBottomRef.current =
        distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };
    pre.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      pre.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Auto-follow the trailing edge while content grows. Gated on isStreaming
  // so we don't yank the user to the bottom on first mount of static source
  // (e.g. patch streams, where `code` doesn't grow at all). If the user
  // scrolls up to read earlier output during a real content stream,
  // stickToBottomRef goes false and we leave them alone until they scroll
  // back near the bottom.
  useEffect(() => {
    if (!isStreaming) return;
    const pre = preRef.current;
    if (pre && stickToBottomRef.current) {
      pre.scrollTop = pre.scrollHeight;
    }
  }, [code, html, isStreaming]);

  // When the first patch target appears, scroll the matched region into view
  // so the user actually sees the diff — patch streams don't trigger the
  // auto-follow above (no content growth) and the source might be long.
  const patchesCount = highlightPatches?.length ?? 0;
  const previouslyHighlightedRef = useRef(false);
  useEffect(() => {
    if (patchesCount === 0) {
      previouslyHighlightedRef.current = false;
      return;
    }
    if (previouslyHighlightedRef.current) return;
    previouslyHighlightedRef.current = true;
    const pre = preRef.current;
    const firstDel = pre?.querySelector('del');
    if (firstDel instanceof HTMLElement) {
      firstDel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [patchesCount]);

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(e) => onContentChange(e.target.value)}
        className={cn(
          'bg-muted text-foreground h-full w-full resize-none p-4 font-mono text-xs leading-relaxed',
          'focus:outline-none',
        )}
        spellCheck={false}
        aria-label={t('canvas.codeEditor')}
      />
    );
  }

  const caret = isStreaming ? (
    <span
      aria-hidden="true"
      className="bg-foreground/80 ml-0.5 inline-block h-3 w-[2px] animate-pulse align-middle"
    />
  ) : null;

  // Patch streaming: render an inline diff preview — each patch's `search`
  // is struck through and the `replace` (when present) is rendered as an
  // addition next to it. Plain-text fallback for shiki's sake; see
  // renderWithDiff for the trade-off discussion.
  if (highlightPatches && highlightPatches.length > 0) {
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          {renderWithDiff(code, highlightPatches)}
          {caret}
        </code>
      </pre>
    );
  }

  if (!html) {
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          {code}
          {caret}
        </code>
      </pre>
    );
  }

  return (
    <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
      <code className="text-xs leading-relaxed">
        <span dangerouslySetInnerHTML={{ __html: html }} />
        {caret}
      </code>
    </pre>
  );
}

export const CanvasCodeRenderer = memo(CanvasCodeRendererComponent);
