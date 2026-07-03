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
  // Runtime function-log lines (`<timestamp> [CONVEX A(...)] [LOG] …`) carry
  // their own severity tag and are clearly NOT the left-aligned prose body of
  // a push failure — they end any armed error block (`blockEnd`). Without
  // this, one failed push painted every later runtime log line (successes
  // included) with the error marker until the next successful push.
  const runtimeLog = /\[CONVEX [A-Z]+\([^)]*\)\]/.test(body);
  if (runtimeLog) {
    if (/\[ERROR\]|Uncaught/.test(body)) {
      return {
        kind: 'error',
        text: body,
        raw: line,
        source: 'convex',
        blockEnd: true,
      };
    }
    if (/\[WARN\]/.test(body)) {
      return {
        kind: 'warn',
        text: body,
        raw: line,
        source: 'convex',
        blockEnd: true,
      };
    }
    return { ...noise(line, 'convex'), blockEnd: true };
  }

  // Push/deploy failure header. Convex prints the server error on the FOLLOWING
  // lines as left-aligned prose (not an indented stack), so flag it as a block
  // error — the stream classifier then keeps that body surfaced until the next
  // milestone instead of dropping it as noise. Matched by text (not just the ✖
  // glyph) so a non-TTY CI run, where the glyph may be absent, still surfaces it.
  if (/Hit an error while (pushing|running)|while pushing to/i.test(body)) {
    return {
      kind: 'error',
      errorBlock: true,
      text: body.replace(/^[✖✗✘]\s*/, ''),
      raw: line,
      source: 'convex',
    };
  }
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
