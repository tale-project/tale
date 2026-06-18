/**
 * Vite (dev / build / preview) output classifier. Surfaces the ready line, the
 * Local URL, and the build-complete line as clean info; collapses HMR churn to
 * noise; surfaces transform/build/port errors verbatim.
 *
 * node-free.
 */

import { stripAnsi } from '../../terminal/ansi';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

export const classifyVite: Classifier = (line) => {
  const body = stripAnsi(line);
  if (
    /^X \[ERROR\]|Internal server error|Pre-transform error|Transform failed|Build failed|Port \d+ is already in use|^\s*Error:/.test(
      body,
    )
  ) {
    return {
      kind: 'error',
      text: body.replace(/^X \[ERROR\]\s*/, ''),
      raw: line,
      source: 'vite',
    };
  }
  const ready = body.match(/VITE v[\d.]+\s+ready in\s+([\d.]+\s*m?s)/);
  if (ready)
    return {
      kind: 'info',
      text: `vite ready (${ready[1]})`,
      raw: line,
      source: 'vite',
    };
  const built = body.match(/✓ built in\s+([\d.]+\s*m?s)/);
  if (built)
    return {
      kind: 'info',
      text: `built (${built[1]})`,
      raw: line,
      source: 'vite',
    };
  const local = body.match(/➜\s+Local:\s+(\S+)/);
  if (local) return { kind: 'info', text: local[1], raw: line, source: 'vite' };
  // HMR churn and everything else → noise.
  return noise(line, 'vite');
};
