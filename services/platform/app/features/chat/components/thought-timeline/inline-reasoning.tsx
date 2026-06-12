'use client';

import { Brain, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ThoughtStep } from '../../utils/thought-step-types';
import { ReasoningStepRow, STEP_INDENT } from './step-rows';
import { ThinkingDots } from './thinking-dots';

/**
 * A reasoning block rendered INLINE between answer chunks. Collapsed by default;
 * expansion is user-controlled and STICKY — it never auto-expands while
 * streaming nor auto-collapses when done (honors the calmer collapsed-by-default
 * rule). The brain header reveals the reasoning prose on click (typewriter while
 * live). Redacted blocks show a neutral note and aren't expandable.
 */
export function InlineReasoning({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
  active: boolean;
}) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);

  if (step.redacted) {
    return (
      <p className="text-muted-foreground my-2 text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }

  const streaming = active && step.state === 'streaming';
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
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
        <span>{t('thoughtProcess.thinking')}</span>
        {streaming && <ThinkingDots />}
      </button>
      {expanded && (
        <div id={bodyId} className={cn('mt-2', STEP_INDENT)}>
          <ReasoningStepRow step={step} active={active} />
        </div>
      )}
    </div>
  );
}
