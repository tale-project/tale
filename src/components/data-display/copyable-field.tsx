'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@tale/ui/cn';
import { Description } from '@tale/ui/description';
import { useT } from '@tale/ui/i18n/client';
import { Label } from '@tale/ui/label';
import { HStack } from '@tale/ui/layout';
import { SkeletonBox } from '@tale/ui/skeleton';
import { TooltipContent } from '@tale/ui/tooltip';
import { useCopyButton } from '@tale/ui/use-copy';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';

import {
  CopyValueButton,
  RevealToggle,
  type RevealLabels,
} from '../forms/field-value-actions';

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
  /**
   * The value is a secret. Dots stand for it, whatever its length, until the
   * eye inside the pill shows it; the copy button copies it without showing
   * it. While it is masked the value is nowhere in the page: not in the text,
   * not in a name, not in a tooltip. The pill then holds two buttons, so it
   * is no button itself, and `copyAriaLabel` names the copy button. A reveal
   * ends with the masking: a value that stops being masked and is masked again
   * starts hidden.
   */
  masked?: boolean;
  /** The words of the eye (default "Show value" / "Hide value"): name what it shows. */
  revealLabels?: RevealLabels;
  /**
   * Show the whole value: wrapped at the pill's edge, its line breaks kept,
   * instead of one line cut short with an ellipsis. For a value that is read,
   * not just copied: a note, a long answer. Like `masked`, it makes the pill
   * hold the copy button beside the text, named by `copyAriaLabel`.
   */
  wrap?: boolean;
  /** What a screen reader hears for the dots of a masked value (default "Hidden"). */
  hiddenLabel?: string;
  /** What a screen reader hears once the value is copied (default "Copied"). */
  copiedLabel?: string;
}

/**
 * The border and fill of the pill, as the pill-button draws them, with less
 * padding above and below: the 24px buttons are taller than a line of text,
 * and the pill still ends up as tall as the plain one (40px). Under a coarse
 * pointer each button's target reaches 10px past its box, so the gap grows to
 * 20px (as in a masked `Input`) and a tap beside one button is not taken by the
 * other.
 */
const PILL =
  'ring-border bg-muted/40 flex w-full gap-2 pointer-coarse:gap-5 rounded-lg border px-3 py-1.75 transition-colors';

/**
 * A read-only "ID field" pill: a single bordered container that shows a value
 * and an inline copy affordance. Matches the design-system ID Field pattern.
 *
 * A plain value is the pill itself: one button, named by its label and value,
 * that copies on press. A secret (`masked`) or a value shown whole (`wrap`)
 * cannot be: its name would be the value, which the page must not hold while
 * it is masked and which a screen reader should not read out line by line. It
 * is shown beside real buttons instead, in the same pill.
 */
const CopyableFieldBase = React.memo(function CopyableFieldBase(
  props: CopyableFieldProps,
) {
  return props.masked === true || props.wrap === true ? (
    <SplitCopyableField {...props} />
  ) : (
    <PillCopyableField {...props} />
  );
});
CopyableFieldBase.displayName = 'CopyableFieldBase';

function PillCopyableField({
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
      {/* AppShell owns TooltipProvider. Overflow tips stay on the trigger —
          hovering the tip body is not required for a truncated value. */}
      <TooltipPrimitive.Root>
        {/* Uncontrolled on purpose: gating happens by withholding the CONTENT
          below — flipping Radix between controlled and uncontrolled on the
          first hover leaves it stuck closed. */}
        <TooltipPrimitive.Trigger asChild>
          <SkeletonBox asChild>
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
          </SkeletonBox>
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
      {description && (
        <Description id={descriptionId}>{description}</Description>
      )}
      <span id={statusId} className="sr-only" role="status" aria-live="polite">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </div>
  );
}

/** A secret, or a value shown whole: the text and its buttons side by side in one pill. */
function SplitCopyableField({
  value,
  label,
  description,
  mono = true,
  inputClassName,
  className,
  copiedDuration,
  copyAriaLabel,
  onCopy,
  onCopyError,
  masked = false,
  revealLabels,
  wrap = false,
  copiedLabel,
  hiddenLabel,
}: CopyableFieldProps) {
  const { t } = useT('common');
  const reactId = React.useId();
  const labelId = `${reactId}-label`;
  const valueTextId = `${reactId}-value-text`;
  const descriptionId = `${reactId}-description`;
  const [revealed, setRevealed] = React.useState(false);
  // A reveal belongs to the masking that gave it: once the value is no longer
  // masked it is forgotten, so a mask that comes back starts hidden instead of
  // showing a value the person last saw masked.
  if (revealed && !masked) setRevealed(false);
  const hidden = masked && !revealed;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <Label id={labelId}>{label}</Label>}
      <SkeletonBox asChild>
        <div
          role="group"
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            PILL,
            // A line of text sits on the buttons' axis; several lines hang from the top.
            wrap ? 'items-start' : 'items-center',
            inputClassName,
          )}
        >
          <span
            id={valueTextId}
            className={cn(
              // `py-0.5` makes a line of text as tall as a button, so one
              // line sits on the buttons' axis and the first of several
              // lines hangs level with them.
              'text-muted-foreground min-w-0 flex-1 py-0.5 text-sm leading-5 wrap-anywhere whitespace-pre-wrap',
              mono && 'font-mono',
            )}
          >
            {hidden ? (
              <>
                <span aria-hidden="true">••••••••</span>
                <span className="sr-only">
                  {hiddenLabel ?? t('aria.hiddenValue')}
                </span>
              </>
            ) : (
              value
            )}
          </span>
          {/* Copy comes before the eye, as it does in a masked `Input`. */}
          <CopyValueButton
            getValue={() => value}
            label={copyAriaLabel}
            copiedLabel={copiedLabel}
            copiedDuration={copiedDuration}
            onCopy={onCopy}
            onCopyError={onCopyError}
          />
          {masked && (
            <RevealToggle
              revealed={revealed}
              onToggle={() => setRevealed((shown) => !shown)}
              labels={
                revealLabels ?? {
                  show: t('aria.showValue'),
                  hide: t('aria.hideValue'),
                }
              }
            />
          )}
        </div>
      </SkeletonBox>
      {description && (
        <Description id={descriptionId}>{description}</Description>
      )}
    </div>
  );
}

// Labels and descriptions keep their layout; the value pill masks itself.
export const CopyableField = CopyableFieldBase;

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
