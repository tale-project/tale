'use client';

import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useMessageFeedback } from '../hooks/use-message-feedback';

interface MessageFeedbackProps {
  messageId: string;
  threadId: string;
  organizationId: string;
}

export function MessageFeedback({
  messageId,
  threadId,
  organizationId,
}: MessageFeedbackProps) {
  const { t } = useT('chat');
  const { feedback, submitFeedback, removeFeedback } = useMessageFeedback({
    messageId,
    threadId,
    organizationId,
  });

  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentRating = feedback?.rating ?? null;

  const handleThumbsUp = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (currentRating === 'positive') {
        await removeFeedback();
      } else {
        await submitFeedback('positive');
        setShowCommentBox(false);
        setComment('');
      }
    } catch {
      // Silently handle feedback errors — UI re-enables via finally
    } finally {
      setIsSubmitting(false);
    }
  }, [currentRating, isSubmitting, submitFeedback, removeFeedback]);

  const handleThumbsDown = useCallback(async () => {
    if (isSubmitting) return;
    if (currentRating === 'negative') {
      setIsSubmitting(true);
      try {
        await removeFeedback();
        setShowCommentBox(false);
        setComment('');
      } catch {
        // Silently handle feedback errors — UI re-enables via finally
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setIsSubmitting(true);
      try {
        await submitFeedback('negative');
        setShowCommentBox(true);
      } catch {
        // Silently handle feedback errors — UI re-enables via finally
      } finally {
        setIsSubmitting(false);
      }
    }
  }, [currentRating, isSubmitting, submitFeedback, removeFeedback]);

  const handleSubmitComment = useCallback(async () => {
    if (isSubmitting || !comment.trim()) return;
    setIsSubmitting(true);
    try {
      await submitFeedback('negative', comment.trim());
      setShowCommentBox(false);
      setComment('');
    } catch {
      // Silently handle feedback errors — UI re-enables via finally
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, comment, submitFeedback]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmitComment();
      }
      if (e.key === 'Escape') {
        setShowCommentBox(false);
      }
    },
    [handleSubmitComment],
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center">
        <Tooltip content={t('feedback.thumbsUp')} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="p-1"
            onClick={handleThumbsUp}
            disabled={isSubmitting}
            aria-label={t('feedback.thumbsUp')}
            aria-pressed={currentRating === 'positive'}
          >
            <ThumbsUp
              className={cn(
                'size-4',
                currentRating === 'positive' &&
                  'fill-current text-green-600 dark:text-green-400',
              )}
            />
          </Button>
        </Tooltip>
        <Tooltip content={t('feedback.thumbsDown')} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="p-1"
            onClick={handleThumbsDown}
            disabled={isSubmitting}
            aria-label={t('feedback.thumbsDown')}
            aria-pressed={currentRating === 'negative'}
          >
            <ThumbsDown
              className={cn(
                'size-4',
                currentRating === 'negative' &&
                  'fill-current text-red-600 dark:text-red-400',
              )}
            />
          </Button>
        </Tooltip>
      </div>

      {showCommentBox && currentRating === 'negative' && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleCommentKeyDown}
            placeholder={t('feedback.commentPlaceholder')}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground min-h-[60px] w-full max-w-sm resize-none rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:ring-offset-0 focus:outline-none"
            aria-label={t('feedback.commentPlaceholder')}
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSubmitComment}
              disabled={isSubmitting || !comment.trim()}
            >
              {t('feedback.submitComment')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCommentBox(false);
                setComment('');
              }}
            >
              {t('feedback.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
