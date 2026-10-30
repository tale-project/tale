'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@tale/ui/cn';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

import {
  type IndicatorBox,
  useSlidingIndicator,
} from '../../hooks/use-sliding-indicator';
import { Tooltip } from '../overlays/tooltip';
import { FieldShell } from './field-shell';
import { Label } from './label';

interface SegmentedControlOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Drawn before the label. With `labels="selected"` every option needs
   * one: it is all an unselected option shows. */
  icon?: LucideIcon;
  /**
   * Something in this option waits on the reader, in the reader's language
   * ("2 items need you"): a quiet accent dot on the option, and this sentence
   * read after its label.
   */
  attention?: string;
}

interface SegmentedControlProps {
  id?: string;
  label?: string;
  required?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  options: SegmentedControlOption[];
  disabled?: boolean;
  className?: string;
  /**
   * `all` shows every option's label. `selected` shows the chosen option's
   * label beside its icon and every other option as its icon alone, named by
   * its label (a tooltip shows it on hover); a highlight glides to the chosen
   * option while its label opens. Each further option then costs an icon, not
   * a word, so the control keeps its width in every language. When even the
   * chosen label has no room, it folds to its icon too, never cut short.
   */
  labels?: 'all' | 'selected';
  /** Names the group when there is no visible `label`. */
  'aria-label'?: string;
  /** Names the group after visible text elsewhere, when there is no `label`. */
  'aria-labelledby'?: string;
}

/** The quiet mark an option with `attention` carries; its meaning is read
 * out with the label, so the dot itself is decorative. */
function AttentionDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="attention-dot"
      className={cn(
        'animate-in zoom-in-50 bg-primary size-1.5 shrink-0 rounded-full duration-300 motion-reduce:animate-none',
        // A contrast theme would paint the dot in the page's own colour:
        // it takes the colour of the option's text instead.
        'forced-colors:[background-color:currentColor] forced-colors:[forced-color-adjust:none]',
        className,
      )}
    />
  );
}

/**
 * A segmented button group for choosing between a small set of mutually
 * exclusive options — the compact alternative to radio buttons when there
 * are only 2–4 options and descriptions are not needed. With icons and
 * `labels="selected"` it also suits a switcher whose options may grow or
 * whose labels run long in another language.
 *
 * Selection is never cleared: if the user clicks the active option, nothing
 * changes (preventing an empty state).
 */
export function SegmentedControl({
  id: providedId,
  label,
  required,
  value,
  onValueChange,
  options,
  disabled,
  className,
  labels = 'all',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SegmentedControlProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const isNavigationKeyPressed = useRef(false);
  const navigationKeyGeneration = useRef(0);
  const compact = labels === 'selected';

  const handleValueChange = (next: string) => {
    // Radix calls this with '' when the user re-clicks the active item.
    // We treat the control as always-selected, so ignore empty.
    if (next) onValueChange(next);
  };

  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const optionsKey = options
    .map((option) => `${option.value}:${option.label}`)
    .join('|');
  const labelFits = useChosenLabelFits(
    compact ? group : null,
    `${value}|${optionsKey}`,
  );
  const indicator = useSlidingIndicator<HTMLDivElement>(
    compact ? value : null,
    `${labelFits}|${optionsKey}`,
    settledOptionBox,
  );
  const { containerRef } = indicator;
  const groupRef = useCallback(
    (node: HTMLDivElement | null) => {
      setGroup(node);
      containerRef(node);
    },
    [containerRef],
  );
  const [hinted, setHinted] = useState<string | null>(null);
  // Labels open and close on the thumb's timing once the control has been
  // seen; the first measure settles them where they belong without motion.
  const [moving, setMoving] = useState(false);
  useLayoutEffect(() => {
    if (!compact) return undefined;
    const frame = requestAnimationFrame(() => setMoving(true));
    return () => cancelAnimationFrame(frame);
  }, [compact]);

  return (
    <FieldShell
      {...(label
        ? {
            label: (
              <Label id={`${id}-label`} required={required}>
                {label}
              </Label>
            ),
          }
        : {})}
    >
      <ToggleGroupPrimitive.Root
        ref={groupRef}
        type="single"
        value={value}
        onValueChange={handleValueChange}
        disabled={disabled}
        onKeyDown={(event) => {
          const generation = ++navigationKeyGeneration.current;
          isNavigationKeyPressed.current = [
            'ArrowRight',
            'ArrowLeft',
            'ArrowDown',
            'ArrowUp',
            'Home',
            'End',
          ].includes(event.key);
          if (isNavigationKeyPressed.current) {
            setTimeout(() => {
              // A newer key can arrive before this older reset runs.
              if (navigationKeyGeneration.current === generation) {
                isNavigationKeyPressed.current = false;
              }
            });
          }
        }}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${id}-label` : ariaLabelledBy}
        className={cn(
          'border-border bg-muted inline-flex gap-0.5 rounded-md border p-0.5',
          // Hugs its options and never grows past its column: the room
          // beside it is what the chosen label measures itself against.
          compact && 'relative w-fit max-w-full items-center',
          className,
        )}
      >
        {compact && (
          <span
            aria-hidden
            data-slot="segmented-thumb"
            style={indicator.style}
            className={cn(
              'dark:bg-background pointer-events-none absolute top-0 left-0 rounded-sm bg-white shadow-xs',
              indicator.transitionClassName,
            )}
          />
        )}
        {options.map((option) => {
          const Icon = option.icon;
          const chosen = option.value === value;
          // An option without an icon has nothing else to show.
          const labelShown =
            !compact || Icon === undefined || (chosen && labelFits);
          const glyph =
            Icon === undefined ? null : (
              <span className="relative flex shrink-0">
                <Icon aria-hidden className="size-4" />
                {compact &&
                  option.attention !== undefined && (
                    // Cut out of the glyph in the colour of what lies behind
                    // it: the track, or the thumb once chosen.
                    <AttentionDot className="ring-muted dark:group-data-[state=on]:ring-background absolute -top-0.5 -right-0.5 ring-2 group-data-[state=on]:ring-white" />
                  )}
              </span>
            );
          return (
            <ToggleGroupPrimitive.Item
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              data-indicator-key={compact ? option.value : undefined}
              onFocus={() => {
                if (isNavigationKeyPressed.current && option.value !== value) {
                  onValueChange(option.value);
                }
              }}
              className={cn(
                compact
                  ? 'group hover:text-foreground relative z-10 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-sm px-1.5 text-xs font-medium transition-colors duration-150'
                  : 'flex-1 cursor-pointer rounded-sm px-3 py-1.5 text-xs font-medium transition-all duration-150',
                'text-muted-foreground',
                // The compact control's highlight is the gliding thumb, so
                // its options only change colour.
                compact
                  ? 'data-[state=on]:text-foreground'
                  : 'dark:data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:bg-white data-[state=on]:shadow-xs',
                !compact &&
                  (Icon !== undefined || option.attention !== undefined) &&
                  'inline-flex items-center justify-center gap-1.5',
                // A contrast theme repaints every tint, drops the shadow and
                // paints a backplate behind text whose background was set: the
                // chosen option takes its own colours back, in the system's
                // selection pair.
                'forced-colors:data-[state=on]:[background-color:Highlight] forced-colors:data-[state=on]:[color:HighlightText] forced-colors:data-[state=on]:[forced-color-adjust:none]',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
                'disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              {compact && glyph !== null ? (
                <Tooltip
                  content={option.label}
                  side="bottom"
                  open={hinted === option.value && !labelShown}
                  onOpenChange={(open) => {
                    setHinted((current) =>
                      open
                        ? option.value
                        : current === option.value
                          ? null
                          : current,
                    );
                  }}
                >
                  {/* The tip answers anywhere on the option's cell, out to
                      its padding, without covering the label beside it. */}
                  <span className="-m-1.5 flex shrink-0 p-1.5">{glyph}</span>
                </Tooltip>
              ) : (
                glyph
              )}
              {compact && Icon !== undefined ? (
                // The label stays in the accessible name while folded; its
                // width opens and closes on the thumb's own timing.
                <span
                  data-slot="segmented-label-frame"
                  data-shown={labelShown}
                  className={cn(
                    'grid',
                    moving &&
                      '[transition:grid-template-columns_280ms_var(--ease-out-quint),opacity_150ms_ease-out] motion-reduce:transition-none',
                    labelShown
                      ? 'grid-cols-[1fr] opacity-100'
                      : 'grid-cols-[0fr] opacity-0',
                  )}
                >
                  <span className="min-w-0 overflow-hidden">
                    <span
                      data-slot="segmented-label"
                      className="block w-max pr-0.5 pl-1.5 whitespace-nowrap"
                    >
                      {option.label}
                    </span>
                  </span>
                </span>
              ) : (
                option.label
              )}
              {(!compact || Icon === undefined) &&
                option.attention !== undefined && <AttentionDot />}
              {option.attention !== undefined && (
                <span className="sr-only">{`, ${option.attention}`}</span>
              )}
            </ToggleGroupPrimitive.Item>
          );
        })}
      </ToggleGroupPrimitive.Root>
    </FieldShell>
  );
}

/**
 * Where an option will stand once every label has finished opening or
 * closing: each label frame before it, and its own, moved from its width now
 * to the width it is heading for. The thumb glides there on the labels'
 * timing instead of chasing the option frame by frame.
 */
function settledOptionBox(item: HTMLElement, box: IndicatorBox): IndicatorBox {
  const group = item.parentElement;
  if (group === null) return box;
  let shift = 0;
  let grow = 0;
  for (const frame of group.querySelectorAll<HTMLElement>(
    '[data-slot="segmented-label-frame"]',
  )) {
    const label = frame.querySelector('[data-slot="segmented-label"]');
    const settled =
      frame.dataset.shown === 'true' && label !== null
        ? label.getBoundingClientRect().width
        : 0;
    const delta = settled - frame.getBoundingClientRect().width;
    if (item.contains(frame)) grow += delta;
    else if (
      item.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_PRECEDING
    ) {
      shift += delta;
    }
  }
  return { ...box, x: box.x + shift, width: box.width + grow };
}

/**
 * Whether the chosen option's label fits beside the other options' icons
 * within the room the group's column gives it. Counted from the options'
 * own boxes and the label's natural width, never from the group's current
 * width, so neither a label opening mid-glide nor the thumb passing over the
 * edge can flip the answer.
 */
function useChosenLabelFits(
  group: HTMLElement | null,
  /** Changes whenever the chosen option or any option's label does. */
  layoutKey: string,
) {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const column = group?.parentElement;
    if (group === null || column === null || column === undefined) {
      return undefined;
    }
    const measure = () => {
      const options = group.querySelectorAll<HTMLElement>(
        ':scope > [data-indicator-key]',
      );
      const first = options[0];
      const last = options[options.length - 1];
      if (first === undefined || last === undefined) return;
      // Measured on screen, then scaled back to layout pixels: a dialog
      // zooming in as it opens shrinks every box by the same factor.
      const scale =
        group.offsetWidth > 0
          ? group.getBoundingClientRect().width / group.offsetWidth
          : 1;
      let span =
        last.getBoundingClientRect().right - first.getBoundingClientRect().left;
      for (const frame of group.querySelectorAll<HTMLElement>(
        '[data-slot="segmented-label-frame"]',
      )) {
        span -= frame.getBoundingClientRect().width;
      }
      const chosen = group.querySelector<HTMLElement>(
        '[data-state="on"] [data-slot="segmented-label"]',
      );
      span += chosen?.getBoundingClientRect().width ?? 0;
      const own = getComputedStyle(group);
      const outer = getComputedStyle(column);
      const px = (length: string) => parseFloat(length) || 0;
      const needed =
        span / scale +
        px(own.paddingLeft) +
        px(own.paddingRight) +
        px(own.borderLeftWidth) +
        px(own.borderRightWidth);
      const room =
        column.clientWidth - px(outer.paddingLeft) - px(outer.paddingRight);
      // Half a pixel absorbs sub-pixel rounding at an exact fit.
      setFits(needed <= room + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    observer.observe(column);
    for (const label of group.querySelectorAll(
      '[data-slot="segmented-label"]',
    )) {
      observer.observe(label);
    }
    return () => observer.disconnect();
  }, [group, layoutKey]);
  return fits;
}
