'use client';

import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { Label } from '@/app/components/ui/forms/label';
import { HStack } from '@/app/components/ui/layout/layout';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface CopyableFieldProps {
  /** The value to display and copy */
  value: string;
  /** Optional label for the field */
  label?: string;
  /** Whether to show the value in a monospace font */
  mono?: boolean;
  /** Additional className for the pill container */
  inputClassName?: string;
  /** Additional className for the outer wrapper */
  className?: string;
  /** Duration in ms to show the copied state (default: 2000) */
  copiedDuration?: number;
  /** Custom aria-label for the copy button */
  copyAriaLabel?: string;
  /** Callback when copy succeeds */
  onCopy?: () => void;
  /** Callback when copy fails */
  onCopyError?: (error: Error) => void;
}

/**
 * A read-only "ID field" pill: a single bordered container that shows a value
 * and an inline copy affordance. Matches the design-system ID Field pattern.
 */
export const CopyableField = React.memo(function CopyableField({
  value,
  label,
  mono = true,
  inputClassName,
  className,
  copiedDuration = 2000,
  copyAriaLabel,
  onCopy,
  onCopyError,
}: CopyableFieldProps) {
  const { t: tCommon } = useT('common');
  const reactId = React.useId();
  const valueId = `${reactId}-value`;
  const statusId = `${reactId}-status`;
  const { copied, onClick } = useCopyButton(value, {
    copiedDuration,
    onSuccess: onCopy,
    onError: onCopyError,
  });

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <Label htmlFor={valueId}>{label}</Label>}
      <button
        id={valueId}
        type="button"
        onClick={onClick}
        aria-label={copyAriaLabel || tCommon('actions.copy')}
        aria-describedby={copied ? statusId : undefined}
        className={cn(
          'ring-border bg-muted/40 hover:bg-muted/60',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
          'flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.25 text-left transition-colors',
          inputClassName,
        )}
      >
        <span
          className={cn(
            'text-muted-foreground flex-1 truncate text-sm',
            mono && 'font-mono',
          )}
          title={value}
        >
          {value}
        </span>
        {copied ? (
          <Check
            className="size-4 shrink-0 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
        ) : (
          <Copy
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </div>
  );
});

interface CopyableTextProps {
  /** The value to display and copy */
  value: string;
  /** Additional className */
  className?: string;
  /** Duration in ms to show the copied state (default: 2000) */
  copiedDuration?: number;
}

/**
 * A simple text span with a copy button.
 * Useful for inline copyable values like IDs.
 */
export const CopyableText = React.memo(function CopyableText({
  value,
  className,
  copiedDuration = 2000,
}: CopyableTextProps) {
  const { t: tCommon } = useT('common');
  const { copied, onClick } = useCopyButton(value, { copiedDuration });

  return (
    <HStack gap={1} align="center" className={cn('inline-flex', className)}>
      <span className="font-mono text-sm" title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={onClick}
        className="hover:bg-muted shrink-0 cursor-pointer rounded p-0.5 transition-colors"
        aria-label={tCommon('actions.copy')}
      >
        {copied ? (
          <Check
            className="size-3.5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
        ) : (
          <Copy className="text-muted-foreground size-3.5" aria-hidden="true" />
        )}
      </button>
    </HStack>
  );
});
