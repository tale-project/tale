/**
 * Convex CLI (`convex dev`) output classifier. Gates readiness on the
 * "N functions ready" line, surfaces push/type errors verbatim, collapses the
 * push/bundle churn to progress, and hides the idle watcher line.
 *
 * node-free.
 */

import { stripAnsi } from '../../terminal/ansi';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

export const classifyConvex: Classifier = (line) => {
  const body = stripAnsi(line);
  if (/^[✖✗]|^\s*✘|Uncaught|Error:|error:/.test(body)) {
    return {
      kind: 'error',
      text: body.replace(/^[✖✗✘]\s*/, ''),
      raw: line,
      source: 'convex',
    };
  }
  const ready = body.match(/✔?\s*(\d+)\s+functions ready!?\s*(?:\(([^)]+)\))?/);
  if (ready) {
    return {
      kind: 'info',
      text: ready[2]
        ? `${ready[1]} functions ready (${ready[2]})`
        : `${ready[1]} functions ready`,
      raw: line,
      source: 'convex',
    };
  }
  if (
    /^✔\s+(Schema validation|Added (table )?index|Provisioned|Added function|Created)/.test(
      body,
    )
  ) {
    return {
      kind: 'info',
      text: body.replace(/^✔\s*/, ''),
      raw: line,
      source: 'convex',
    };
  }
  if (
    /^(Preparing Convex functions|Pushing|Bundling|codegen wrote|Downloading)/.test(
      body,
    )
  ) {
    return {
      kind: 'progress',
      text: 'pushing functions',
      status: { phase: 'convex' },
      raw: line,
      source: 'convex',
    };
  }
  // Everything else — including the idle `Watching for file changes...` line —
  // is noise. (A test pins the watcher case so the intent survives refactors.)
  return noise(line, 'convex');
};
