'use client';

/**
 * Section Renderers for Structured AI Responses
 *
 * Only [[NEXT_STEPS]] receives special rendering (as follow-up buttons).
 * All other markers are stripped by the parser and their content renders
 * as plain markdown.
 */

import { memo, useMemo } from 'react';

import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { parseFollowUpItems } from '@/lib/utils/parse-follow-up-items';

// ============================================================================
// NEXT STEPS SECTION
// ============================================================================

interface NextStepsSectionProps {
  content: string;
  isStreaming?: boolean;
  onSendFollowUp?: (message: string) => void;
}

export const NextStepsSection = memo(
  function NextStepsSection({
    content,
    isStreaming,
    onSendFollowUp,
  }: NextStepsSectionProps) {
    const { t } = useT('chat');

    const items = useMemo(() => parseFollowUpItems(content), [content]);

    if (items.length === 0 && !isStreaming) return null;
    if (!onSendFollowUp) return null;

    return (
      <section aria-label={t('structured.nextSteps')}>
        <Text variant="label-sm" className="text-muted-foreground mb-2">
          {t('structured.nextSteps')}
        </Text>
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
          {isStreaming && (
            <Skeleton className="h-7 w-28" label={t('structured.nextSteps')} />
          )}
        </div>
      </section>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.onSendFollowUp === next.onSendFollowUp,
);
