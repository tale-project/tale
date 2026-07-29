'use client';

/**
 * The system-role rows of the transcript, routed by their `[TAG]`.
 *
 * The backend prefixes system messages with a `SYSTEM_MSG_TAG` and the
 * display map assigns each tag a presentation: 'pill' reads as a compact
 * right-aligned confirmation (a human-input answer landing in the flow),
 * short warnings/errors read as a one-line annotation, and everything else
 * folds into the collapsible box below — first lines visible, the rest
 * behind a chevron, with alert/status semantics for screen readers.
 *
 * An untagged system message falls through to the plain parts renderer
 * unchanged. The specialized notices main grew for structured bodies
 * (model-fallback, generation-incomplete, step-limit) are deliberately NOT
 * ported: nothing on this branch writes those tags yet, so they render via
 * the generic display-map path until a writer exists.
 */

import { Row } from '@tale/ui/layout';
import { cva } from 'class-variance-authority';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import {
  getSystemMessageDisplay,
  parseSystemMessageTag,
  type SystemMessageDisplay,
} from '@/lib/shared/constants/system-message-tags';
import { cn } from '@/lib/utils/cn';

import type { MessagePart } from '../types';
import { MessageParts } from './message-parts';

type CollapsibleVariant = Exclude<SystemMessageDisplay, 'pill'>;

/** A warning/error this short renders as a single annotation line instead
 * of the boxed treatment — one line of prose, no fold. */
const INLINE_NOTICE_MAX_CHARS = 120;

const containerVariants = cva('overflow-hidden rounded-lg border text-xs', {
  variants: {
    variant: {
      info: 'bg-muted/50 text-muted-foreground border-transparent',
      success: 'bg-success/10 text-success border-success/30',
      warning: 'bg-warning/10 text-warning border-warning/30',
      error: 'bg-destructive/10 text-destructive border-destructive/30',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const VARIANT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
} as const;

/** The boxed treatment: the first two non-empty lines as a preview, the
 * rest behind an expand chevron. Warnings/errors announce as alerts. */
const CollapsibleSystemMessage = memo(function CollapsibleSystemMessage({
  content,
  variant = 'info',
}: {
  content: string;
  variant?: CollapsibleVariant;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const lines = content.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim() !== '');
  const previewLines = nonEmptyLines.slice(0, 2);
  const preview = previewLines.join(' ');
  const lastPreviewIdx =
    previewLines.length > 0
      ? lines.indexOf(previewLines[previewLines.length - 1])
      : 0;
  const rest = lines
    .slice(lastPreviewIdx + 1)
    .join('\n')
    .trimStart();
  const hasMore = rest.length > 0;

  const Icon = VARIANT_ICONS[variant];
  const isAlertRole = variant === 'warning' || variant === 'error';

  return (
    <div
      // The row's parent is a shrink-wrapping flex column — w-full keeps the
      // box spanning the transcript like main's block-flow context did.
      className="w-full py-1"
      role={isAlertRole ? 'alert' : 'status'}
      aria-live={isAlertRole ? 'assertive' : undefined}
    >
      <div className={containerVariants({ variant })}>
        <button
          type="button"
          className="flex w-full items-start gap-2 px-3 py-1.5"
          onClick={toggle}
          disabled={!hasMore}
          aria-expanded={expanded}
        >
          <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 text-left">{preview}</span>
          {hasMore && (
            <ChevronDown
              className={cn(
                'mt-0.5 ml-auto size-3.5 shrink-0 transition-transform',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          )}
        </button>
        {expanded && (
          <div className="max-h-60 overflow-y-auto border-t border-current/10 px-3 py-2 whitespace-pre-wrap">
            {rest}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Route one system message to its presentation. `text` is the message's
 * precomputed plain text ("[TAG] body"); `parts` carry the untagged
 * fallback so a message no tag claims renders exactly as before.
 */
export function SystemNotice({
  text,
  parts,
}: {
  text: string;
  parts: readonly MessagePart[];
}) {
  const { tag, body } = parseSystemMessageTag(text);

  if (tag === null) {
    return <MessageParts parts={parts} />;
  }

  const display = getSystemMessageDisplay(tag);

  if (display === 'pill') {
    return (
      <Row gap={0} align="stretch" justify="end" className="w-full">
        <Row
          gap={2}
          className="bg-primary/10 text-primary rounded-full px-4 py-2 text-sm"
        >
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <span>{body}</span>
        </Row>
      </Row>
    );
  }

  const isShortInline =
    (display === 'warning' || display === 'error') &&
    !body.includes('\n') &&
    body.length < INLINE_NOTICE_MAX_CHARS;

  if (isShortInline) {
    return (
      <div
        role="alert"
        className={cn(
          'flex items-center gap-1.5 px-4 py-1 text-xs',
          display === 'error' ? 'text-destructive' : 'text-warning',
        )}
      >
        <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{body}</span>
      </div>
    );
  }

  return <CollapsibleSystemMessage content={body} variant={display} />;
}
