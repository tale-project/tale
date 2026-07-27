'use client';

/**
 * The actions under one settled assistant message — Copy, Show info, and the
 * feedback pair (thumbs latch; thumbs-down opens an inline comment field).
 *
 * The LAST message's toolbar is always visible; history rows reveal on hover,
 * keyboard focus, or coarse pointers (the hover group lives on the message
 * item, `group/message`). An errored or blocked turn keeps only Show info:
 * there is no answer worth copying or rating, but the "what happened" trail
 * matters most exactly then.
 *
 * Ratings render from the thread-wide feedback map (one watch per thread) —
 * a click flips a local override immediately and reconciles when the map
 * catches up, so the latch never waits on the round-trip.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { Row, Stack } from '@tale/ui/layout';
import {
  Check,
  Copy,
  GitFork,
  Info,
  MoreHorizontal,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useState } from 'react';

import { useCopy } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  useFeedbackActions,
  type FeedbackRating,
} from '../data/feedback-actions';
import { messagePlainText } from '../lib/message-text';
import type { ChatMessageView } from '../types';
import { MessageInfoDialog } from './message-info-dialog';

interface MessageToolbarProps {
  message: ChatMessageView;
  /** The last message keeps its toolbar on screen; history rows reveal it. */
  alwaysVisible: boolean;
  /** The conversation the message belongs to. Absent on surfaces that carry
   * no feedback (a shared snapshot) — the thumbs simply do not render. */
  organizationId?: string;
  threadId?: string;
  /** The caller's stored rating for this message, from the thread map. */
  rating?: FeedbackRating;
  /** Re-answer the prompt this reply answered, as a sibling branch. */
  onRegenerate?: (message: ChatMessageView) => void;
  /** Fork the conversation up to this message into a visible new chat. */
  onFork?: (message: ChatMessageView) => void;
}

export function MessageToolbar({
  message,
  alwaysVisible,
  organizationId,
  threadId,
  rating,
  onRegenerate,
  onFork,
}: MessageToolbarProps) {
  const { t } = useT('chat');
  const { t: tCommon } = useT('common');
  const { copied, copy } = useCopy();
  const [infoOpen, setInfoOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  // undefined = follow the server map; null = optimistically removed.
  const [localRating, setLocalRating] = useState<
    FeedbackRating | null | undefined
  >(undefined);
  const feedback = useFeedbackActions(organizationId ?? '');

  const errored =
    message.error !== undefined || message.blockedReason !== undefined;
  const text = messagePlainText(message.parts);
  const canRate =
    !errored &&
    feedback.available &&
    organizationId !== undefined &&
    threadId !== undefined;
  const effectiveRating = localRating === undefined ? rating : localRating;

  const applyRating = (next: FeedbackRating | null) => {
    if (threadId === undefined) return;
    setLocalRating(next);
    const call =
      next === null
        ? feedback.remove(message.id)
        : feedback.submit(threadId, message.id, next);
    void call.then((ok) => {
      // On failure fall back to whatever the server map says.
      if (!ok) setLocalRating(undefined);
    });
  };

  const handleThumbsUp = () => {
    setCommentOpen(false);
    applyRating(effectiveRating === 'positive' ? null : 'positive');
  };

  const handleThumbsDown = () => {
    if (effectiveRating === 'negative') {
      setCommentOpen(false);
      applyRating(null);
      return;
    }
    // The rating lands immediately; the comment field refines it after.
    applyRating('negative');
    setComment('');
    setCommentOpen(true);
  };

  const submitComment = () => {
    if (threadId !== undefined && comment.trim().length > 0) {
      void feedback.submit(threadId, message.id, 'negative', comment.trim());
    }
    setCommentOpen(false);
  };

  return (
    <Stack
      gap={1}
      className={cn(
        'mt-1',
        // `has-[[data-state=open]]` keeps the toolbar on screen while its
        // overflow menu is open — the menu portals outside the hover group,
        // so without it opening the menu faded its own trigger away.
        !alwaysVisible &&
          'opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 pointer-coarse:opacity-100',
      )}
    >
      <Row gap={1}>
        {!errored && text.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={
              copied ? tCommon('actions.copied') : tCommon('actions.copy')
            }
            data-testid="message-copy-button"
            onClick={() => void copy(text)}
            className="size-7"
          >
            {copied ? (
              <Check aria-hidden className="text-success size-3.5" />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
          </Button>
        )}
        <Button
          size="icon"
          variant="ghost"
          aria-label={tCommon('actions.showInfo')}
          data-testid="message-info-button"
          onClick={() => setInfoOpen(true)}
          className="size-7"
        >
          <Info aria-hidden className="size-3.5" />
        </Button>
        {canRate && (
          <>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('feedback.thumbsUp')}
              aria-pressed={effectiveRating === 'positive'}
              data-testid="message-thumbs-up"
              onClick={handleThumbsUp}
              className="size-7"
            >
              <ThumbsUp
                aria-hidden
                className={cn(
                  'size-3.5',
                  effectiveRating === 'positive' && 'text-success fill-current',
                )}
              />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('feedback.thumbsDown')}
              aria-pressed={effectiveRating === 'negative'}
              data-testid="message-thumbs-down"
              onClick={handleThumbsDown}
              className="size-7"
            >
              <ThumbsDown
                aria-hidden
                className={cn(
                  'size-3.5',
                  effectiveRating === 'negative' &&
                    'text-destructive fill-current',
                )}
              />
            </Button>
          </>
        )}
        {!errored && onFork !== undefined && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('forkChat')}
            data-testid="message-fork-button"
            onClick={() => onFork(message)}
            className="size-7"
          >
            <GitFork aria-hidden className="size-3.5" />
          </Button>
        )}
        {onRegenerate !== undefined && (
          <DropdownMenu
            align="start"
            trigger={
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('moreActions')}
                data-testid="message-more-button"
                className="size-7"
              >
                <MoreHorizontal aria-hidden className="size-3.5" />
              </Button>
            }
            items={[
              [
                {
                  type: 'item',
                  label: t('tryAgain'),
                  icon: RotateCcw,
                  onClick: () => onRegenerate(message),
                },
              ],
            ]}
          />
        )}
      </Row>

      {commentOpen && (
        <Stack gap={2} className="max-w-md">
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder={t('feedback.commentPlaceholder')}
            aria-label={t('feedback.commentPlaceholder')}
            autoFocus
            rows={2}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submitComment();
              }
              if (event.key === 'Escape') setCommentOpen(false);
            }}
            className="border-border bg-muted/40 focus-visible:ring-ring min-h-[60px] w-full resize-none rounded-lg border px-3 py-2 text-sm focus-visible:ring-1 focus-visible:outline-none"
          />
          <Row gap={2}>
            <Button size="sm" onClick={submitComment} className="h-7">
              {t('feedback.submitComment')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCommentOpen(false)}
              className="h-7"
            >
              {tCommon('actions.cancel')}
            </Button>
          </Row>
        </Stack>
      )}

      {/* Mounted only while open — a hidden dialog per history row would be
          pure overhead in long threads. */}
      {infoOpen && (
        <MessageInfoDialog
          message={message}
          open={infoOpen}
          onOpenChange={setInfoOpen}
        />
      )}
    </Stack>
  );
}
