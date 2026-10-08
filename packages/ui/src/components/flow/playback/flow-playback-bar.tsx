'use client';

import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '../../../i18n/client';
import { cn } from '../../../lib/cn';
import { Badge } from '../../feedback/badge';
import { SegmentedControl } from '../../forms/segmented-control';
import { Select } from '../../forms/select';
import { Slider } from '../../forms/slider';
import { Card } from '../../layout/card';
import { Button } from '../../primitives/button';
import {
  FLOW_PLAYBACK_SPEEDS,
  type FlowPlaybackSpeed,
  type FlowPlaybackTimeline,
} from './types';
import { nextFlowEvent, previousFlowEvent } from './use-playback-clock';

export interface FlowPlaybackBarProps {
  timeline: FlowPlaybackTimeline;
  t: number;
  onTChange: (t: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  speed?: FlowPlaybackSpeed;
  /** Shows the speed choice when given. */
  onSpeedChange?: (speed: FlowPlaybackSpeed) => void;
  /**
   * The clock's words for a moment ("00:42"). Defaults to playback time;
   * pass `toReal`-based words to show how long the run really took.
   */
  formatTime?: (t: number) => string;
  /** What is happening at `t` ("Score (Running)"), for the scrubber's
   *  spoken value. */
  activity?: string;
  /** A live run: a "Follow live" button shows while `t` is behind its end. */
  onFollowLive?: () => void;
  className?: string;
}

/** "01:05", or "1:02:05" past an hour. */
export function formatFlowClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** The speed an option's value names; 1× for anything else. */
const speedOf = (value: string): FlowPlaybackSpeed =>
  FLOW_PLAYBACK_SPEEDS.find((speed) => String(speed) === value) ?? 1;

/** Share of the timeline a key moves by. */
const STEP = 0.01;
const PAGE = 0.1;

/**
 * The controls of a run's replay: play or pause, the previous and next
 * event, a scrubber with a tick for every event (failures in the error
 * red, waits as a hatched band), the time, the speed, and on a live run
 * "Live" with a way back to its end.
 *
 * The host owns time (`t`, `playing`, `speed`) — pair it with
 * `usePlaybackClock`. Keys: Space plays or pauses anywhere on the bar
 * except a button, ←/→ move the scrubber by 1 % and Page Up/Page Down by
 * 10 %, Home/End jump to the ends, `[` and `]` step between events.
 */
export function FlowPlaybackBar({
  timeline,
  t,
  onTChange,
  playing,
  onPlayingChange,
  speed = 1,
  onSpeedChange,
  formatTime = formatFlowClock,
  activity,
  onFollowLive,
  className,
}: FlowPlaybackBarProps) {
  const { t: tr } = useT('flow');
  const { i18n } = useTranslation();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
  const duration = Math.max(0, timeline.duration);
  const position = tr('playback.position', {
    elapsed: formatTime(t),
    total: formatTime(duration),
  });
  const valueText =
    activity === undefined || activity === ''
      ? position
      : tr('playback.valueText', { position, events: activity });

  const speedOptions = useMemo(() => {
    const number = new Intl.NumberFormat(locale);
    return FLOW_PLAYBACK_SPEEDS.map((value) => ({
      value: String(value),
      label: `${number.format(value)}×`,
    }));
  }, [locale]);

  const percent = (at: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (at / duration) * 100)) : 0;
  const failures = (timeline.marks ?? []).filter(
    (mark) => mark.kind === 'failure',
  );
  const waits = (timeline.marks ?? []).filter((mark) => mark.kind === 'wait');

  const move = (to: number) => onTChange(Math.min(duration, Math.max(0, to)));

  const onSliderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const by: Record<string, number> = {
      ArrowLeft: -STEP,
      ArrowDown: -STEP,
      ArrowRight: STEP,
      ArrowUp: STEP,
      PageDown: -PAGE,
      PageUp: PAGE,
    };
    const step = by[event.key];
    if (step !== undefined) {
      event.preventDefault();
      move(t + step * duration);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(duration);
    }
  };

  const onBarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    const onButton =
      target instanceof HTMLElement &&
      target.closest('button, [role="combobox"], [role="radio"]') !== null;
    if (event.key === ' ' && !onButton) {
      event.preventDefault();
      onPlayingChange(!playing);
    } else if (event.key === '[') {
      event.preventDefault();
      move(previousFlowEvent(timeline, t));
    } else if (event.key === ']') {
      event.preventDefault();
      move(nextFlowEvent(timeline, t));
    }
  };

  const behindLive = timeline.live === true && t < duration;

  return (
    <Card
      padding="none"
      role="group"
      aria-label={tr('playback.label')}
      onKeyDown={onBarKeyDown}
      className={cn('flex min-h-11 items-center gap-1 px-1', className)}
    >
      <Button
        size="icon"
        variant="ghost"
        title={tr(playing ? 'playback.pause' : 'playback.play')}
        onClick={() => onPlayingChange(!playing)}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={tr('playback.previous')}
        onClick={() => move(previousFlowEvent(timeline, t))}
      >
        <SkipBack className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        title={tr('playback.next')}
        onClick={() => move(nextFlowEvent(timeline, t))}
      >
        <SkipForward className="size-4" />
      </Button>
      <div className="relative mx-1 flex min-w-24 flex-1 flex-col justify-center gap-1">
        <Slider
          value={t}
          min={0}
          max={duration}
          step={1}
          onChange={(event) => move(Number(event.target.value))}
          onKeyDown={onSliderKeyDown}
          aria-label={tr('playback.label')}
          aria-valuetext={valueText}
        />
        {/* The thumb's centre runs 10 px in from each end; so do the ticks. */}
        <div aria-hidden="true" className="relative mx-2.5 h-1.5">
          {waits.map((mark) => {
            const end = nextFlowEvent(timeline, mark.at);
            return (
              <span
                key={`wait-${mark.at}`}
                title={mark.label}
                data-flow-mark="wait"
                className="text-muted-foreground absolute top-0 h-1.5 rounded-xs bg-[repeating-linear-gradient(135deg,currentColor_0_2px,transparent_2px_4px)]"
                style={{
                  left: `${percent(mark.at)}%`,
                  width: `${Math.max(1, percent(end) - percent(mark.at))}%`,
                }}
              />
            );
          })}
          {timeline.events.map((at) => (
            <span
              key={`event-${at}`}
              data-flow-mark="event"
              className="bg-muted-foreground absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full"
              style={{ left: `${percent(at)}%` }}
            />
          ))}
          {failures.map((mark) => (
            <span
              key={`failure-${mark.at}`}
              title={mark.label}
              data-flow-mark="failure"
              className="bg-destructive absolute top-0 h-1.5 w-0.5 -translate-x-1/2 rounded-full"
              style={{ left: `${percent(mark.at)}%` }}
            />
          ))}
        </div>
      </div>
      <span
        aria-hidden="true"
        className="text-muted-foreground shrink-0 px-1 text-xs tabular-nums"
      >
        {position}
      </span>
      {onSpeedChange && (
        <>
          <SegmentedControl
            aria-label={tr('playback.speed')}
            value={String(speed)}
            onValueChange={(value) => onSpeedChange(speedOf(value))}
            options={speedOptions}
            className="hidden sm:inline-flex"
          />
          <div className="sm:hidden">
            <Select
              aria-label={tr('playback.speed')}
              value={String(speed)}
              onValueChange={(value) => onSpeedChange(speedOf(value))}
              options={speedOptions}
              className="h-9 w-20"
            />
          </div>
        </>
      )}
      {timeline.live === true && (
        <Badge variant="destructive" icon={Radio} className="shrink-0">
          {tr('playback.live')}
        </Badge>
      )}
      {behindLive && onFollowLive && (
        <Button size="sm" variant="secondary" onClick={onFollowLive}>
          {tr('playback.followLive')}
        </Button>
      )}
    </Card>
  );
}
