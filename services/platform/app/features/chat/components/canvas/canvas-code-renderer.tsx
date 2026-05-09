'use client';

import {
  memo,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useTheme } from '@/app/components/theme/theme-provider';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode } from '@/lib/utils/shiki';

import { buildHunks } from './build-hunks';
import { PatchHunkView } from './patch-hunk-view';

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
   * builds focused hunks from these and shows only the changed regions plus
   * ±3 context lines, instead of materialising the full source per push. */
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

/**
 * Renders a (potentially multi-hundred-KB) growing text by appending the
 * delta to a DOM text node in place — bypassing React's reconciler for the
 * payload itself. Each Convex push during streaming costs O(delta size)
 * here, not O(total content size) as it would if React diffed
 * `{code}` as a child on every render.
 *
 * Without this, a 200 KB artifact's render time grows past the inter-push
 * interval; React batches subsequent updates; the user sees the bursty
 * "wait, then a big chunk lands" cadence the larger plan was meant to
 * fix. This component is the last mile.
 *
 * Reset semantics: if `code` is no longer a prefix-extension of the
 * previously rendered text (e.g. the artifact switched, or the stream
 * was aborted and restarted), we fall back to a single `textContent`
 * write — still O(N) for that one transition, but rare.
 */
function IncrementalText({ code }: { code: string }) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const renderedRef = useRef('');

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const prev = renderedRef.current;
    if (code === prev) return;
    if (prev !== '' && code.startsWith(prev)) {
      const delta = code.slice(prev.length);
      if (delta.length > 0) {
        el.appendChild(document.createTextNode(delta));
      }
    } else {
      el.textContent = code;
    }
    renderedRef.current = code;
  }, [code]);

  // First mount: hostRef populates via the layout effect synchronously
  // before paint, so there's no visible flash of empty content.
  return <span ref={hostRef} />;
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

  // Defer expensive render inputs so React can commit a previous snapshot
  // immediately and schedule the heavy work (hunk recomputation, plain-text
  // re-render of a 30 KB+ string) at low priority.
  //
  // EXCEPTION: during create/rewrite streaming we deliberately skip the
  // defer for `code`. The streaming path now delivers many small chunks
  // per second from the agent SDK — `useDeferredValue` ends up starving
  // the deferred render as new updates keep arriving, which the user
  // perceives as bursty "wait several seconds, then a big chunk" output.
  // Each render is small (just the bytes added since the last push) so
  // there is no main-thread blocking concern. Patch-stream `highlightPatches`
  // and the post-stream settled view still benefit from deferral.
  const deferredCodeFallback = useDeferredValue(code);
  const renderedCode = isStreaming ? code : deferredCodeFallback;
  const deferredHighlightPatches = useDeferredValue(highlightPatches);

  // Build hunks from the (possibly stale) deferred patch list. Memoized on
  // both inputs so we only re-walk the source when patches actually change.
  // For typical artifacts (10s of KB), this is a single-digit-ms scan; for
  // very large artifacts the cost stays linear in source size but materially
  // smaller than the prior `renderWithDiff` (which produced a ReactNode array
  // spanning the whole document on every Convex push).
  const hunks = useMemo(
    () =>
      deferredHighlightPatches && deferredHighlightPatches.length > 0
        ? buildHunks(deferredCodeFallback, deferredHighlightPatches)
        : null,
    [deferredCodeFallback, deferredHighlightPatches],
  );

  // Skip shiki during a live stream or while a patch diff is on screen.
  // Re-tokenising the whole document on every code-grow tick falls behind
  // fast streams: the cancellation flag turns each result into a no-op so
  // `html` state never advances, and the user perceives a "burst, silence,
  // burst" cadence as shiki finally completes a pass during a stream pause.
  // Patch streams already render via the hunk view (plain-text), so highlighting
  // the full source there is wasted work. The size guard lives inside
  // highlightCode itself (see MAX_SHIKI_BYTES) — it returns null for content
  // larger than the threshold and we fall through to the plain-text branch.
  const skipShiki =
    isStreaming ||
    (highlightPatches !== undefined && highlightPatches.length > 0);
  useEffect(() => {
    if (isEditing) return undefined;
    if (skipShiki) {
      // Drop any prior html so when the stream ends we don't briefly flash
      // stale highlighted source from a previous pass before the fresh
      // shiki call lands on the settled content. React bails out if html
      // is already '' so this is cheap to call unconditionally.
      setHtml('');
      return undefined;
    }
    let cancelled = false;
    void highlightCode(code, language, shikiTheme).then((result) => {
      if (!cancelled && result) {
        setHtml(extractShikiCodeContent(result.html));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, shikiTheme, isEditing, skipShiki]);

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
  //
  // The actual scroll write is scheduled inside requestAnimationFrame so we
  // don't force a layout flush in the same tick as the React commit that
  // mutated the DOM — the prior synchronous version reflowed the whole `<pre>`
  // twice per stream chunk on large content. The early "already there"
  // bail-out avoids no-op rAF schedules when the stream is idle.
  useEffect(() => {
    if (!isStreaming) return undefined;
    const pre = preRef.current;
    if (!pre || !stickToBottomRef.current) return undefined;
    const target = pre.scrollHeight - pre.clientHeight;
    if (pre.scrollTop >= target) return undefined;
    const id = requestAnimationFrame(() => {
      const live = preRef.current;
      if (live && stickToBottomRef.current) {
        live.scrollTop = live.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [renderedCode, html, isStreaming]);

  if (isEditing) {
    // Uncontrolled textarea: `defaultValue` is read once on mount and the DOM
    // owns the typing state thereafter. The `onChange` still notifies the
    // parent — the parent stores the latest text in its edit buffer so Apply
    // / Copy / Download see the freshest content — but React no longer
    // re-writes a 200 KB `value` attribute on every keystroke (the dominant
    // cost in the prior controlled version). The textarea unmounts whenever
    // `isEditing` flips off or `artifactId` changes (parent resets the flag),
    // so `defaultValue` correctly re-seeds on the next mount.
    return (
      <textarea
        ref={textareaRef}
        defaultValue={code}
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

  // Patch streaming: render the focused hunk view. Patches whose `search`
  // doesn't (yet) match anywhere in the source produce zero hunks — fall back
  // to the plain deferred source so the pane never goes empty.
  if (highlightPatches && highlightPatches.length > 0) {
    if (hunks && hunks.length > 0) {
      return <PatchHunkView hunks={hunks} />;
    }
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          <IncrementalText code={renderedCode} />
          {caret}
        </code>
      </pre>
    );
  }

  if (!html) {
    return (
      <pre ref={preRef} className="bg-muted h-full overflow-auto p-4">
        <code className="text-xs leading-relaxed">
          <IncrementalText code={renderedCode} />
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
