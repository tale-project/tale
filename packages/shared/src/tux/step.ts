/**
 * `runStep` — run a long phase as a single live-updating status line that ends in
 * one of three terminals: `[ ✓ ]` done, `[ ! ]` warn (degraded but continued), or
 * `[ x ]` error. While a step runs it is the SINGLE writer (a `LiveRegion`); any
 * output captured during it is the owner's responsibility to hold and dump only
 * on failure, so success is clean by construction.
 *
 * In non-interactive mode it degrades to append-only lines (start + result),
 * emitting no cursor escapes.
 */

import { formatElapsed } from '../terminal/index';
import { LiveRegion } from '../terminal/live';
import {
  ensureTeardownRegistered,
  getCapabilities,
  getMarkers,
  getPalette,
  getReporterLevel,
  setActiveRegion,
} from './context';
import { doneLine, errorLine, stepStartLine, warnLine } from './lines';

/**
 * Throw from a `runStep` task to end the step as `[ ! ]` warn (degraded but
 * continuing) instead of `[ x ]` error. It is NOT rethrown, so the caller
 * proceeds; `runStep` returns `undefined`.
 */
export class StepWarning extends Error {}

/**
 * A step label. A plain string is used verbatim for every state; an
 * `{ active, done }` pair reads as the action while running / on failure
 * (`Starting X`) and past tense once finished (`X started`).
 */
export type StepLabel = string | { active: string; done: string };

const SPINNER_INTERVAL_MS = 80;

/**
 * Run a long phase as a single live-updating status line. Resolves with the
 * task's value on success, `undefined` on a {@link StepWarning} (soft), and
 * rethrows any other error after flipping the line to `[ x ]`.
 */
export async function runStep<T>(
  label: StepLabel,
  task: () => Promise<T>,
): Promise<T | undefined> {
  const active = typeof label === 'string' ? label : label.active;
  const done = typeof label === 'string' ? label : label.done;
  const start = Date.now();
  const elapsed = (): string => formatElapsed(Date.now() - start);
  const caps = getCapabilities();

  // ── Non-interactive: append-only start + result lines, no cursor escapes. ──
  if (!caps.interactive) {
    stepStartLine(`${active}...`);
    try {
      const result = await task();
      doneLine(`${done} (${elapsed()})`);
      return result;
    } catch (err) {
      if (err instanceof StepWarning) {
        warnLine(`${active} — ${err.message} (${elapsed()})`);
        return undefined;
      }
      errorLine(active);
      throw err;
    }
  }

  // ── Interactive: a spinner repainted by a single timer (the only painter). ──
  ensureTeardownRegistered();
  const palette = getPalette();
  const markers = getMarkers();
  const region = new LiveRegion({ capabilities: caps, registerExit: () => {} });
  setActiveRegion(region);
  let tick = 0;
  const render = (): void => {
    const frame = markers.spinnerFrames[tick % markers.spinnerFrames.length];
    region.render([
      `${palette.cyan}${frame}${palette.reset} ${active} ${palette.dim}(${elapsed()})${palette.reset}`,
    ]);
  };
  render();
  const timer = setInterval(() => {
    tick++;
    render();
  }, SPINNER_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  const finish = (line: string | null): void => {
    clearInterval(timer);
    region.clear();
    if (line !== null) region.print(line);
    region.dispose();
    setActiveRegion(null);
  };

  try {
    const result = await task();
    // `--quiet` shows no success terminal — just tear the spinner down cleanly.
    finish(
      getReporterLevel() === 'quiet'
        ? null
        : `${palette.green}${markers.done}${palette.reset} ${done} ${palette.dim}(${elapsed()})${palette.reset}`,
    );
    return result;
  } catch (err) {
    if (err instanceof StepWarning) {
      finish(
        `${palette.yellow}${markers.warn}${palette.reset} ${active}${palette.dim} — ${err.message} (${elapsed()})${palette.reset}`,
      );
      return undefined;
    }
    finish(`${palette.red}${markers.error}${palette.reset} ${active}`);
    throw err;
  }
}
