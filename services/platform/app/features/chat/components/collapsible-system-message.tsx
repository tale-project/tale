'use client';

import { cva } from 'class-variance-authority';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Info,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import type { SystemMessageDisplay } from '@/lib/shared/constants/system-message-tags';

import { cn } from '@/lib/utils/cn';

type CollapsibleVariant = Exclude<SystemMessageDisplay, 'pill'>;

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

export const CollapsibleSystemMessage = memo(function CollapsibleSystemMessage({
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
      className="py-1"
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
