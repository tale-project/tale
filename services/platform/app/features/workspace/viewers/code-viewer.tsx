'use client';

import { Button } from '@tale/ui/button';
import { useTheme } from '@tale/ui/theme';
import { WrapText } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode, resolveLanguage } from '@/lib/utils/shiki';
import { getFileExtensionLower } from '@/lib/utils/text-file-types';

interface CodeViewerProps {
  /** File path — used to resolve the syntax highlighter language. */
  path: string;
  /** Decoded text content. */
  content: string;
  /** Optional override; otherwise inferred from the path extension. */
  language?: string;
  /** When true, shows a "wrap lines" toggle in a small header strip. */
  showWrapToggle?: boolean;
  className?: string;
}

const OVERSIZE_BYTES = 64_000;

/**
 * Syntax-highlighted code preview used by:
 *  - the thread workspace canvas (renders any text-ish file by extension)
 *  - the skills detail page (renders a single asset out of a bundle)
 *
 * Hoisted out of `skill-asset-viewer.tsx` so both surfaces share one shiki
 * implementation, one oversize cutoff, and one "wrap lines" affordance.
 * Tab handling intentionally stays simple (no scrolling-to-line, no diff
 * gutters) — the canvas does not need an editor, only a viewer.
 */
function CodeViewerComponent({
  path,
  content,
  language,
  showWrapToggle = false,
  className,
}: CodeViewerProps) {
  const { t } = useT('settings');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);

  const ext = getFileExtensionLower(path);
  const resolvedLang = language ?? resolveLanguage(ext);
  const oversize = content.length > OVERSIZE_BYTES;

  useEffect(() => {
    setHighlightedHtml(null);
    if (!content || oversize) return undefined;
    let cancelled = false;
    void highlightCode(content, resolvedLang, shikiTheme).then((result) => {
      if (!cancelled) setHighlightedHtml(result?.html ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [content, resolvedLang, oversize, shikiTheme]);

  const highlightRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (el && highlightedHtml) el.innerHTML = highlightedHtml;
    },
    [highlightedHtml],
  );

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      {showWrapToggle && (
        <div className="border-border bg-muted/30 flex shrink-0 items-center justify-end border-b px-2 py-1">
          <Button
            variant="ghost"
            size="sm"
            icon={WrapText}
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            aria-label={t('skills.viewer.toggleWrap', {
              defaultValue: 'Toggle line wrap',
            })}
          />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {oversize ? (
          <pre
            className={cn(
              'm-0 p-4',
              wrap ? 'break-words whitespace-pre-wrap' : 'overflow-auto',
            )}
          >
            <code className="text-foreground font-mono text-xs leading-relaxed">
              {content}
            </code>
          </pre>
        ) : highlightedHtml ? (
          <div
            ref={highlightRef}
            className={cn(
              'code-line-numbers text-sm [&_code]:text-xs [&_code]:leading-relaxed [&_pre]:m-0! [&_pre]:p-4!',
              wrap
                ? '[&_pre]:break-words [&_pre]:whitespace-pre-wrap'
                : '[&_pre]:overflow-auto',
            )}
          />
        ) : (
          <pre
            className={cn(
              'm-0 p-4',
              wrap ? 'break-words whitespace-pre-wrap' : 'overflow-auto',
            )}
          >
            <code className="text-foreground font-mono text-xs leading-relaxed">
              {content}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

export const CodeViewer = memo(CodeViewerComponent);
