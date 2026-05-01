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
  /** When provided (patch streams), each entry is a `search` snippet the
   * model has emitted so far. The renderer wraps the first occurrence of
   * each in `<mark>` so the user sees which regions are about to change. */
  highlightTargets?: readonly string[];
  onContentChange: (content: string) => void;
}

/** Pixel tolerance for considering the pre "at the bottom". Mirrors the
 * inline code-block in message-bubble so the two feel consistent. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

/**
 * Wrap the first non-overlapping occurrence of each target in <mark>.
 * Plain-text rendering — used during patch streams when we want to surface
 * which regions are about to change, in lieu of syntax highlighting which
 * cannot accept overlay marks without re-parsing the shiki output.
 */
function renderWithHighlights(
  code: string,
  targets: readonly string[],
): ReactNode[] {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const target of targets) {
    if (!target) continue;
    const idx = code.indexOf(target);
    if (idx === -1) continue;
    const start = idx;
    const end = idx + target.length;
    // Skip if this range overlaps an already-claimed one. First-write-wins
    // keeps the visualisation deterministic when the model emits patches
    // whose `search` snippets happen to nest.
    const overlaps = ranges.some((r) => !(end <= r.start || start >= r.end));
    if (!overlaps) ranges.push({ start, end });
  }
  if (ranges.length === 0) return [code];
  ranges.sort((a, b) => a.start - b.start);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const r = ranges[i];
    if (cursor < r.start) parts.push(code.slice(cursor, r.start));
    parts.push(
      <mark
        key={`mark-${r.start}`}
        className="bg-warning/20 ring-warning/40 rounded-sm px-0.5 ring-1 ring-inset"
      >
        {code.slice(r.start, r.end)}
      </mark>,
    );
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
  highlightTargets,
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
  // so the user actually sees the highlight — patch streams don't trigger
  // the auto-follow above (no content growth) and the source might be long.
  const targetsCount = highlightTargets?.length ?? 0;
  const previouslyHighlightedRef = useRef(false);
  useEffect(() => {
    if (targetsCount === 0) {
      previouslyHighlightedRef.current = false;
      return;
    }
    if (previouslyHighlightedRef.current) return;
    previouslyHighlightedRef.current = true;
    const pre = preRef.current;
    const firstMark = pre?.querySelector('mark');
    if (firstMark instanceof HTMLElement) {
      firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetsCount]);

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

  // Patch streaming: surface the search snippets the model has emitted as
  // <mark> ranges over the static settled source. We render plain text in
  // this branch because the shiki HTML output cannot host overlay marks
  // without re-parsing token boundaries — the trade-off (no syntax colour
  // for the few seconds of patch streaming) is worth the explicit signal.
  if (highlightTargets && highlightTargets.length > 0) {
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          {renderWithHighlights(code, highlightTargets)}
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
