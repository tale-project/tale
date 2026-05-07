import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '../../lib/cn';

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step'
> {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /**
   * Tick mark values rendered along the track. Each value is positioned
   * proportionally between `min` and `max`. Useful for hinting at the
   * scale of the range.
   */
  ticks?: readonly number[];
  /**
   * Optional label rendered above the thumb while the user is interacting
   * (pointer-down, focus, or actively changing the value). Auto-hides
   * after `valueLabelHideDelay` ms of inactivity.
   */
  valueLabel?: ReactNode;
  /** Time in ms to keep the value label visible after interaction. Default 1500. */
  valueLabelHideDelay?: number;
}

const THUMB_DIAMETER_PX = 20;
const THUMB_HALF_PX = THUMB_DIAMETER_PX / 2;

function clampPct(pct: number): number {
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/**
 * Position an absolutely-positioned element so its center sits over the
 * range thumb's center. Native range thumbs don't extend past the track
 * edges — at 0% the thumb's center is `THUMB_HALF_PX` in from the left,
 * and at 100% it is `THUMB_HALF_PX` in from the right. We linearly
 * interpolate that offset so the overlay tracks the thumb exactly.
 *
 * The same formula doubles as the width of the filled track segment,
 * which always extends from the left edge to the thumb's center.
 */
function thumbOffsetLeft(pct: number): string {
  const offset = THUMB_HALF_PX - pct * (THUMB_HALF_PX / 50);
  const sign = offset >= 0 ? '+' : '-';
  return `calc(${pct.toFixed(2)}% ${sign} ${Math.abs(offset).toFixed(2)}px)`;
}

const inputClasses = cn(
  // The visible track + fill are rendered as overlay divs behind the
  // input — every native track surface is transparent so the rounded
  // pill behind shows through unchanged.
  'relative z-10 block h-5 w-full cursor-pointer appearance-none bg-transparent',
  'focus-visible:outline-none',
  // WebKit / Blink: transparent track, styled thumb
  '[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent',
  '[&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[color:var(--color-accent-base)] [&::-webkit-slider-thumb]:bg-[color:var(--color-bg-base)] [&::-webkit-slider-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.18)] [&::-webkit-slider-thumb]:transition-[transform,box-shadow] [&::-webkit-slider-thumb]:duration-150',
  'hover:[&::-webkit-slider-thumb]:scale-110 hover:[&::-webkit-slider-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]',
  'active:[&::-webkit-slider-thumb]:scale-110',
  'focus-visible:[&::-webkit-slider-thumb]:ring-4 focus-visible:[&::-webkit-slider-thumb]:ring-[color:var(--color-accent-base)]/20',
  // Firefox: transparent track and progress, styled thumb
  '[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent',
  '[&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-transparent',
  '[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[color:var(--color-accent-base)] [&::-moz-range-thumb]:bg-[color:var(--color-bg-base)] [&::-moz-range-thumb]:shadow-[0_1px_3px_rgba(0,0,0,0.18)] [&::-moz-range-thumb]:transition-[transform,box-shadow] [&::-moz-range-thumb]:duration-150',
  'hover:[&::-moz-range-thumb]:scale-110 hover:[&::-moz-range-thumb]:shadow-[0_2px_6px_rgba(0,0,0,0.22)]',
  'focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent-base)_20%,transparent)]',
);

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      value,
      min,
      max,
      step = 1,
      onChange,
      ticks,
      valueLabel,
      valueLabelHideDelay = 1500,
      className,
      onPointerDown,
      onFocus,
      onBlur,
      ...rest
    },
    ref,
  ) => {
    const [showLabel, setShowLabel] = useState(false);
    const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      },
      [],
    );

    function flashLabel() {
      setShowLabel(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        setShowLabel(false);
      }, valueLabelHideDelay);
    }

    function handleChange(event: ChangeEvent<HTMLInputElement>) {
      flashLabel();
      onChange(event);
    }

    const range = max - min;
    const pct = range > 0 ? ((value - min) / range) * 100 : 0;
    const clampedPct = clampPct(pct);
    const fillWidth = thumbOffsetLeft(clampedPct);

    return (
      <div className="relative w-full">
        {valueLabel !== undefined ? (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute -top-9 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-[color:var(--color-accent-base)] px-2 py-1 text-xs font-medium text-[color:var(--color-accent-fg)] shadow-md transition-[opacity,transform] duration-150',
              'after:absolute after:left-1/2 after:top-full after:h-0 after:w-0 after:-translate-x-1/2 after:border-x-4 after:border-t-4 after:border-x-transparent after:border-t-[color:var(--color-accent-base)] after:content-[""]',
              showLabel
                ? 'translate-y-0 opacity-100'
                : 'translate-y-1 opacity-0',
            )}
            style={{ left: thumbOffsetLeft(clampedPct) }}
          >
            {valueLabel}
          </div>
        ) : null}

        <div className="relative flex h-5 w-full items-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[color:var(--color-border-base)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-0 h-2 -translate-y-1/2 rounded-full bg-[color:var(--color-accent-base)]"
            style={{ width: fillWidth }}
          />

          {ticks !== undefined && range > 0 ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-1/2 z-[5] -translate-y-1/2"
            >
              {ticks.map((tick) => {
                const tickPct = clampPct(((tick - min) / range) * 100);
                const isPassed = value >= tick;
                return (
                  <span
                    key={tick}
                    className={cn(
                      'absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors',
                      isPassed
                        ? 'bg-[color:var(--color-accent-fg)]/80'
                        : 'bg-[color:var(--color-fg-muted)]/40',
                    )}
                    style={{ left: thumbOffsetLeft(tickPct) }}
                  />
                );
              })}
            </div>
          ) : null}

          <input
            ref={ref}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            onPointerDown={(event) => {
              flashLabel();
              onPointerDown?.(event);
            }}
            onFocus={(event) => {
              flashLabel();
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setShowLabel(false);
              if (hideTimerRef.current) {
                clearTimeout(hideTimerRef.current);
                hideTimerRef.current = null;
              }
              onBlur?.(event);
            }}
            className={cn(inputClasses, className)}
            {...rest}
          />
        </div>
      </div>
    );
  },
);
Slider.displayName = 'Slider';
