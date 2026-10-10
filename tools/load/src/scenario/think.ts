/**
 * Waiting like a person: think times between clicks, reading time after a
 * reply, back-offs after a refusal — every wait cut short the moment the
 * user is stopped.
 */

import { type Random, logNormal } from '../data/random.ts';

/** Sleep `ms`, resolving early (never rejecting) when `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** The kinds of pause a user takes, by median seconds and spread. */
export const PAUSES = {
  /** Between two clicks on one screen. */
  click: { medianMs: 1_200, sigma: 0.6 },
  /** Reading a list or a page before acting. */
  read: { medianMs: 6_000, sigma: 0.8 },
  /** Composing a short message or a form. */
  type: { medianMs: 9_000, sigma: 0.7 },
  /** Between two journeys: switching context, a coffee. */
  idle: { medianMs: 25_000, sigma: 1.0 },
} as const;

export type PauseKind = keyof typeof PAUSES;

/** Longest single pause, so one tail draw cannot park a user for an hour. */
export const MAX_PAUSE_MS = 10 * 60 * 1_000;

/** A pause of `kind` for this user, scaled by the run's think-time factor. */
export function pauseMs(
  random: Random,
  kind: PauseKind,
  scale: number,
): number {
  const { medianMs, sigma } = PAUSES[kind];
  return Math.min(MAX_PAUSE_MS, logNormal(random, medianMs, sigma) * scale);
}

/**
 * Reading time for a reply of `chars` characters: about 25 characters a
 * second (skimming), at least a couple of seconds, with personal spread.
 */
export function readingMs(
  random: Random,
  chars: number,
  scale: number,
): number {
  const median = Math.max(2_000, (chars / 25) * 1_000);
  return Math.min(MAX_PAUSE_MS, logNormal(random, median, 0.5) * scale);
}

/** Typing time for `chars` characters (~4 a second, pastes are instant). */
export function typingMs(random: Random, chars: number, scale: number): number {
  const median = chars > 600 ? 3_000 : Math.max(1_500, (chars / 4) * 1_000);
  return Math.min(MAX_PAUSE_MS, logNormal(random, median, 0.4) * scale);
}

/**
 * The back-off a `Retry-After` header asks for, in ms: delta-seconds or an
 * HTTP date; `null` when absent or unreadable.
 */
export function retryAfterMs(
  header: string | undefined,
  now: number = Date.now(),
): number | null {
  if (header === undefined || header.trim() === '') return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}
