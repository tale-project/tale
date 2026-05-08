'use client';

import { Badge } from '@tale/ui/badge';
import { useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

interface CountdownBadgeProps {
  /** Absolute target time in ms-since-epoch. */
  effectiveAt: number;
  /** Pretty variant flip when the countdown reaches zero. */
  reachedLabel?: string;
}

function format(remainingMs: number, t: ReturnType<typeof useT>['t']): string {
  if (remainingMs <= 0) return t('legalHold.countdown.ready');
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) return t('legalHold.countdown.soon');
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return t('legalHold.countdown.minutesSeconds', {
      minutes,
      seconds: (totalSeconds % 60).toString().padStart(2, '0'),
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t('legalHold.countdown.hoursMinutes', {
      hours,
      minutes: minutes % 60,
    });
  }
  const days = Math.floor(hours / 24);
  return t('legalHold.countdown.daysHours', { days, hours: hours % 24 });
}

export function CountdownBadge({
  effectiveAt,
  reachedLabel,
}: CountdownBadgeProps) {
  const { t } = useT('governance');
  const [remaining, setRemaining] = useState(() => effectiveAt - Date.now());

  useEffect(() => {
    setRemaining(effectiveAt - Date.now());
    const timer = setInterval(() => {
      const next = effectiveAt - Date.now();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [effectiveAt]);

  if (remaining <= 0) {
    return (
      <Badge variant="green" aria-live="polite">
        {reachedLabel ?? t('legalHold.badges.releaseEffective')}
      </Badge>
    );
  }
  return (
    <Badge variant="orange" aria-live="polite">
      {format(remaining, t)}
    </Badge>
  );
}
