'use client';

/**
 * Section Renderers for Structured AI Responses
 *
 * Each section wraps its own TypewriterText instance for independent
 * streaming animation. Only the actively-streaming section receives
 * isStreaming={true}; completed sections render instantly.
 */

import { memo, useCallback, useMemo, useState } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { parseFollowUpItems } from '@/lib/utils/parse-follow-up-items';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';

// ============================================================================
// SHARED PROPS
// ============================================================================

interface SectionProps {
  content: string;
  isStreaming: boolean;
}

// ============================================================================
// CONCLUSION SECTION
// ============================================================================

export const ConclusionSection = memo(
  function ConclusionSection({ content, isStreaming }: SectionProps) {
    const { t } = useT('chat');

    if (!content && !isStreaming) return null;

    return (
      <section
        className="structured-conclusion mb-3"
        aria-label={t('structured.conclusion')}
      >
        <TypewriterText
          text={content}
          isStreaming={isStreaming}
          components={markdownComponents}
          className={markdownWrapperStyles}
        />
      </section>
    );
  },
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming,
);

// ============================================================================
// KEY POINTS SECTION
// ============================================================================

export const KeyPointsSection = memo(
  function KeyPointsSection({ content, isStreaming }: SectionProps) {
    const { t } = useT('chat');

    if (!content && !isStreaming) return null;

    return (
      <section className="mb-3" aria-label={t('structured.keyPoints')}>
        <TypewriterText
          text={content}
          isStreaming={isStreaming}
          components={markdownComponents}
          className={markdownWrapperStyles}
        />
      </section>
    );
  },
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming,
);

// ============================================================================
// DETAILS SECTION
// ============================================================================

export const DetailsSection = memo(
  function DetailsSection({ content, isStreaming }: SectionProps) {
    const { t } = useT('chat');
    const [isOpen, setIsOpen] = useState(true);

    const handleToggle = useCallback(
      (e: React.SyntheticEvent<HTMLDetailsElement>) => {
        setIsOpen(e.currentTarget.open);
      },
      [],
    );

    if (!content && !isStreaming) return null;

    return (
      <details
        className="structured-details mb-3"
        open={isOpen}
        onToggle={handleToggle}
        aria-label={
          isOpen ? t('structured.hideDetails') : t('structured.showDetails')
        }
      >
        <summary className="text-muted-foreground cursor-pointer text-sm font-medium">
          {isOpen ? t('structured.hideDetails') : t('structured.showDetails')}
        </summary>
        <div className="pt-2">
          <TypewriterText
            text={content}
            isStreaming={isStreaming}
            components={markdownComponents}
            className={markdownWrapperStyles}
          />
        </div>
      </details>
    );
  },
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming,
);

// ============================================================================
// QUESTIONS SECTION
// ============================================================================

export const QuestionsSection = memo(
  function QuestionsSection({ content, isStreaming }: SectionProps) {
    const { t } = useT('chat');

    if (!content && !isStreaming) return null;

    return (
      <section
        className="structured-questions mb-3"
        aria-label={t('structured.questions')}
      >
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          {t('structured.questions')}
        </p>
        <TypewriterText
          text={content}
          isStreaming={isStreaming}
          components={markdownComponents}
          className={markdownWrapperStyles}
        />
      </section>
    );
  },
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming,
);

// ============================================================================
// NEXT STEPS SECTION
// ============================================================================

interface NextStepsSectionProps {
  content: string;
  onSendFollowUp?: (message: string) => void;
}

export const NextStepsSection = memo(
  function NextStepsSection({
    content,
    onSendFollowUp,
  }: NextStepsSectionProps) {
    const { t } = useT('chat');

    const items = useMemo(() => parseFollowUpItems(content), [content]);

    if (items.length === 0 || !onSendFollowUp) return null;

    return (
      <section aria-label={t('structured.nextSteps')}>
        <p className="text-muted-foreground mb-2 text-xs font-medium">
          {t('structured.nextSteps')}
        </p>
        <div className="structured-next-steps">
          {items.map((item) => (
            <Button
              key={item}
              variant="secondary"
              size="sm"
              className={cn(
                'h-auto whitespace-normal py-1.5 text-left text-xs',
                'hover:bg-muted/50',
              )}
              onClick={() => onSendFollowUp?.(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </section>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.onSendFollowUp === next.onSendFollowUp,
);
