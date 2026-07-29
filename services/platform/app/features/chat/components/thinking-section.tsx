'use client';

/**
 * The model's reasoning ("thinking"), rendered as a collapsible block above
 * the answer. Collapsed by default; expansion is user-controlled and STICKY —
 * it never auto-expands while streaming nor auto-collapses when done. The
 * header shows a live "Thinking" state with dots while the model is still
 * reasoning, then latches to "Thought for Ns". The seconds are measured from
 * this section's first live render — an honest local measure, not a server
 * clock.
 */

import { Brain, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

export function ThinkingSection({
  text,
  active,
}: {
  /** The reasoning text streamed so far (or settled). */
  text: string;
  /** The model is still reasoning — the answer has not started. */
  active: boolean;
}) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);

  // Local elapsed measure: starts on the first ACTIVE render, latches when
  // the answer starts. A settled history row never had an active render, so
  // it shows the plain label instead of a fabricated duration.
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    startedAtRef.current ??= Date.now();
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) {
        setElapsedSeconds(
          Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        );
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const label = active
    ? t('thinking.label')
    : elapsedSeconds !== null
      ? t('thinking.done', { seconds: elapsedSeconds })
      : t('thinking.label');

  return (
    <div className="my-2 w-full min-w-0">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
          )}
          aria-hidden="true"
        />
        <Brain className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{label}</span>
        {active && (
          <span aria-hidden className="flex items-center gap-1">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className="bg-muted-foreground/60 size-1 animate-pulse rounded-full motion-reduce:animate-none"
                style={{ animationDelay: `${index * 150}ms` }}
              />
            ))}
          </span>
        )}
      </button>
      {expanded && (
        <div
          id={bodyId}
          className="border-border text-muted-foreground mt-2 border-l-2 pl-3 text-sm"
        >
          <MarkdownContent content={text} />
        </div>
      )}
    </div>
  );
}
