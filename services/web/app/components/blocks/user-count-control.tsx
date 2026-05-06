import { Input } from '@tale/ui/input';
import { Slider } from '@tale/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@tale/ui/tooltip';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { REGION_FORMAT_LOCALE, type Region } from '@/lib/pricing/region';

export const MIN_USERS = 25;
export const SLIDER_MAX_USERS = 1000;
export const SLIDER_TICKS: readonly number[] = [
  100, 200, 300, 400, 500, 600, 700, 800, 900,
];
const MIN_TIP_DURATION_MS = 2500;
const THUMB_HALF_PX = 10;

function tickPositionLeft(value: number, min: number, max: number): string {
  const range = max - min;
  if (range <= 0) return '0%';
  const pct = ((value - min) / range) * 100;
  const clampedPct = Math.min(100, Math.max(0, pct));
  const offset = THUMB_HALF_PX - clampedPct * (THUMB_HALF_PX / 50);
  const sign = offset >= 0 ? '+' : '-';
  return `calc(${clampedPct.toFixed(2)}% ${sign} ${Math.abs(offset).toFixed(2)}px)`;
}

export interface UserCountControlProps {
  value: number;
  onChange: (next: number) => void;
  region: Region;
}

function formatCount(count: number, region: Region): string {
  return new Intl.NumberFormat(REGION_FORMAT_LOCALE[region]).format(count);
}

export function UserCountControl({
  value,
  onChange,
  region,
}: UserCountControlProps) {
  const { t } = useT('pricing');
  const [inputValue, setInputValue] = useState(String(value));
  const [showMinTip, setShowMinTip] = useState(false);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  useEffect(
    () => () => {
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    },
    [],
  );

  function flashMinTip() {
    setShowMinTip(true);
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    tipTimerRef.current = setTimeout(() => {
      setShowMinTip(false);
    }, MIN_TIP_DURATION_MS);
  }

  function handleSliderChange(event: ChangeEvent<HTMLInputElement>) {
    const next = Number(event.target.value);
    if (!Number.isFinite(next)) return;
    setShowMinTip(false);
    onChange(next);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    setInputValue(raw);
    if (raw.trim() === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const floored = Math.floor(parsed);
    if (floored < MIN_USERS) {
      flashMinTip();
      return;
    }
    setShowMinTip(false);
    onChange(floored);
  }

  function handleInputBlur() {
    const parsed = Number(inputValue);
    if (Number.isFinite(parsed) && Math.floor(parsed) < MIN_USERS) {
      onChange(MIN_USERS);
      setInputValue(String(MIN_USERS));
    } else {
      setInputValue(String(value));
    }
    setShowMinTip(false);
  }

  const sliderValue = Math.min(Math.max(value, MIN_USERS), SLIDER_MAX_USERS);
  const label = t('users.label');
  const minTooltip = t('users.minTooltip');

  return (
    <div className="mx-auto mt-6 flex w-full max-w-120 flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <label
          htmlFor="pricing-users-input"
          className="text-fg-base text-sm font-medium"
        >
          {label}
        </label>
        <TooltipProvider delayDuration={0}>
          <Tooltip open={showMinTip}>
            <TooltipTrigger asChild>
              <Input
                id="pricing-users-input"
                type="number"
                inputMode="numeric"
                min={MIN_USERS}
                step={1}
                value={inputValue}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                aria-invalid={showMinTip || undefined}
                className="h-9 w-28 text-right"
              />
            </TooltipTrigger>
            <TooltipContent side="top" align="end">
              {minTooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Slider
        value={sliderValue}
        min={MIN_USERS}
        max={SLIDER_MAX_USERS}
        step={5}
        onChange={handleSliderChange}
        ticks={SLIDER_TICKS}
        valueLabel={formatCount(value, region)}
        aria-label={label}
      />
      <div className="text-fg-muted relative text-xs">
        <div className="flex justify-between">
          <span>{formatCount(MIN_USERS, region)}</span>
          <span>{formatCount(SLIDER_MAX_USERS, region)}+</span>
        </div>
        <span
          aria-hidden
          className="absolute top-0 -translate-x-1/2"
          style={{
            left: tickPositionLeft(500, MIN_USERS, SLIDER_MAX_USERS),
          }}
        >
          {formatCount(500, region)}
        </span>
      </div>
    </div>
  );
}
