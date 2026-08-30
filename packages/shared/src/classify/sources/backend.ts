/**
 * Backend (`node backend/main.ts`) output classifier for the dev loop.
 *
 * The process is a plain Node server: it logs one boot line per subsystem,
 * then per-job/per-request lines. The dev reporter shows errors and
 * milestones and collapses the rest, so a developer sees "backend started"
 * and anything that actually went wrong — not a scrolling job log.
 *
 * node-free.
 */

import { stripAnsi } from '../../terminal/ansi';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

export const classifyBackend: Classifier = (line) => {
  const body = stripAnsi(line);

  if (/Uncaught|Unhandled|\bERROR\b|^\s*Error:|error:/.test(body)) {
    return { kind: 'error', text: body, raw: line, source: 'backend' };
  }
  if (/\bWARN\b|^\s*warn:/.test(body)) {
    return { kind: 'warn', text: body, raw: line, source: 'backend' };
  }
  // The boot milestones worth a line: the HTTP door opening and the job
  // runner attaching. Everything else about a healthy boot is detail.
  if (
    /listening on|\bmigrations? (applied|up to date)\b|worker started/i.test(
      body,
    )
  ) {
    return { kind: 'info', text: body, raw: line, source: 'backend' };
  }
  if (/^\[(boot|migrate|jobs)\]/.test(body)) {
    return {
      kind: 'progress',
      text: 'starting backend',
      status: { phase: 'backend' },
      raw: line,
      source: 'backend',
    };
  }
  return noise(line, 'backend');
};
