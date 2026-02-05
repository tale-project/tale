'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { HStack } from '@/app/components/ui/layout/layout';
import { cn } from '@/lib/utils/cn';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';

interface CopyableFieldProps {
  /** The value to display and copy */
  value: string;
  /** Optional label for the field */
  label?: string;
  /** Whether to show the value in a monospace font */
  mono?: boolean;
  /** Additional className for the input */
  inputClassName?: string;
  /** Additional className for the container */
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
 * An input field with a copy-to-clipboard button.
 * Shows a check icon briefly after successful copy.
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
  const { copied, onClick } = useCopyButton(value, {
    copiedDuration,
    onSuccess: onCopy,
    onError: onCopyError,
  });

  return (
    <HStack gap={2} className={className}>
      <Input
        value={value}
        readOnly
        label={label}
        wrapperClassName="flex-1"
        className={cn(mono && 'font-mono text-sm', inputClassName)}
        aria-describedby={copied ? 'copy-status' : undefined}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('p-1 shrink-0', label && 'mt-6')}
        onClick={onClick}
        aria-label={copyAriaLabel || tCommon('actions.copy')}
      >
        {copied ? (
          <Check
            className="size-4 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </Button>
      {copied && (
        <span id="copy-status" className="sr-only">
          {tCommon('actions.copied')}
        </span>
      )}
    </HStack>
  );
});

export interface CopyableTextProps {
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
      <span className="font-mono text-sm">{value}</span>
      <button
        type="button"
        onClick={onClick}
        className="p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
        aria-label={tCommon('actions.copy')}
      >
        {copied ? (
          <Check
            className="size-3.5 text-green-600 dark:text-green-400"
            aria-hidden="true"
          />
        ) : (
          <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
    </HStack>
  );
});
