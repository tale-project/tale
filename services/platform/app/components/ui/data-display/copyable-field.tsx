'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Description } from '@tale/ui/description';
import { HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { useSkeleton } from '@tale/ui/skeleton-context';
import { TooltipContent } from '@tale/ui/tooltip';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import { Label } from '@/app/components/ui/forms/label';
import { useCopyButton } from '@/app/hooks/use-copy';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

interface CopyableFieldProps {
  /** The value to display and copy */
  value: string;
  /** Optional label for the field */
  label?: string;
  /** Optional description rendered below the field */
  description?: React.ReactNode;
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
const CopyableFieldBase = React.memo(function CopyableFieldBase({
  value,
  label,
  description,
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
  const labelId = `${reactId}-label`;
  const valueId = `${reactId}-value`;
  const valueTextId = `${reactId}-value-text`;
  const statusId = `${reactId}-status`;
  const descriptionId = `${reactId}-description`;
  const { copied, onClick } = useCopyButton(value, {
    copiedDuration,
    onSuccess: onCopy,
    onError: onCopyError,
  });

  // The pill truncates; only then is there hidden content worth a tooltip.
  // Measured on hover/focus (the only moments a tooltip can open) rather
  // than observed continuously — a resize while pointing at the pill is not
  // a case worth a ResizeObserver.
  const valueTextRef = React.useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = React.useState(false);
  const syncOverflow = React.useCallback(() => {
    const el = valueTextRef.current;
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, []);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <Label id={labelId}>{label}</Label>}
      <TooltipPrimitive.Provider delayDuration={300} disableHoverableContent>
        {/* Uncontrolled on purpose: gating happens by withholding the CONTENT
          below — flipping Radix between controlled and uncontrolled on the
          first hover leaves it stuck closed. */}
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            <button
              id={valueId}
              type="button"
              onClick={onClick}
              onPointerEnter={syncOverflow}
              onFocus={syncOverflow}
              aria-labelledby={
                label ? `${labelId} ${valueTextId}` : valueTextId
              }
              aria-label={copyAriaLabel}
              aria-describedby={
                [description ? descriptionId : null, copied ? statusId : null]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              className={cn(
                'ring-border bg-muted/40 hover:bg-muted/60',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
                'flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.25 text-left transition-colors',
                inputClassName,
              )}
            >
              <span
                id={valueTextId}
                ref={valueTextRef}
                className={cn(
                  'text-muted-foreground flex-1 truncate text-sm',
                  mono && 'font-mono',
                )}
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
          </TooltipPrimitive.Trigger>
          {overflowing && (
            <TooltipPrimitive.Portal>
              <TooltipContent
                side="top"
                collisionPadding={8}
                className={cn(
                  'max-w-[min(90vw,40rem)] break-all',
                  mono && 'font-mono',
                )}
              >
                {value}
              </TooltipContent>
            </TooltipPrimitive.Portal>
          )}
        </TooltipPrimitive.Root>
      </TooltipPrimitive.Provider>
      {description && (
        <Description id={descriptionId}>{description}</Description>
      )}
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </div>
  );
});
CopyableFieldBase.displayName = 'CopyableFieldBase';

/**
 * Skeleton-aware CopyableField. Inside a `<Skeletonize loading>` it masks the
 * real pill at its exact footprint, so it doesn't pop in when an id resolves.
 */
export const CopyableField = React.memo(function CopyableField(
  props: CopyableFieldProps,
) {
  const loading = useSkeleton();
  if (loading) {
    // `fullWidth` so the mask is block-level and stacks under sibling fields
    // (matches Input/Select) instead of collapsing to an inline-block box.
    return (
      <SkeletonBox fullWidth>
        <CopyableFieldBase {...props} />
      </SkeletonBox>
    );
  }
  return <CopyableFieldBase {...props} />;
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
