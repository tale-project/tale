/**
 * Tale platform-container entrypoint classifier. The container entrypoints
 * (services/{platform,convex}/docker-entrypoint.sh) log a small, structured
 * vocabulary — timestamped severity words `[<ts>] INFO|OK|WARN|ERROR <msg>`,
 * plus `Reason:`/`missing:` failure detail, the `Tale Platform is running`
 * banner, and `═══` section rules — which we map to error/warn/info/noise.
 *
 * No emoji: the entrypoints emit plain words (so raw `docker logs` is clean
 * too), and the reporter renders severity via its bracketed glyph marker.
 * `stripStatusEmoji` stays as a defensive final scrub so a stray emoji from any
 * other source can never reach the surfaced text.
 *
 * node-free.
 */

import { cleanComposeLine, stripStatusEmoji } from '../internal';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

/** A timestamped entrypoint log line: `[2026-… ] ERROR something happened`. */
const TAGGED = /^\[[^\]]*\]\s+(INFO|OK|WARN|ERROR|FATAL)\s+(.*)$/;

export const classifyPlatformContainer: Classifier = (line) => {
  const body = cleanComposeLine(line);

  const tagged = body.match(TAGGED);
  if (tagged) {
    const level = tagged[1];
    const text = stripStatusEmoji(tagged[2]);
    if (level === 'ERROR' || level === 'FATAL') {
      return { kind: 'error', text, raw: line, source: 'platform-container' };
    }
    if (level === 'WARN') {
      return { kind: 'warn', text, raw: line, source: 'platform-container' };
    }
    // OK is a surfaced milestone; routine INFO collapses to noise.
    if (level === 'OK') {
      return { kind: 'info', text, raw: line, source: 'platform-container' };
    }
    return noise(line, 'platform-container');
  }

  // Untimestamped lines: a leading-WARN diagnostic, structured failure detail,
  // or the ready banner.
  if (/^\s*WARN\b/.test(body)) {
    return {
      kind: 'warn',
      text: stripStatusEmoji(body.replace(/^\s*WARN\s+/, '')),
      raw: line,
      source: 'platform-container',
    };
  }
  if (/^\s*(Reason|missing):/.test(body)) {
    return {
      kind: 'error',
      text: stripStatusEmoji(body),
      raw: line,
      source: 'platform-container',
    };
  }
  if (/Tale Platform is running/.test(body)) {
    return {
      kind: 'info',
      text: 'platform running',
      raw: line,
      source: 'platform-container',
    };
  }
  return noise(line, 'platform-container');
};
