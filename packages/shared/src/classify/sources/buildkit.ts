/**
 * BuildKit (`docker build` / buildx) output classifier. `#N [stage]` step lines
 * and DONE/CACHED/export lines collapse to progress; `ERROR:`/`failed to solve`
 * and the `------` error frame surface as error; a transient blob/buildx flake is
 * a rerunnable warning.
 *
 * node-free.
 */

import { stripAnsi } from '../../terminal/ansi';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

export const classifyBuildKit: Classifier = (line) => {
  const body = stripAnsi(line);
  if (/^ERROR:|failed to solve|^------/.test(body)) {
    return { kind: 'error', text: body, raw: line, source: 'buildkit' };
  }
  if (/blob .* not found|buildx/i.test(body)) {
    return { kind: 'warn', text: body, raw: line, source: 'buildkit' };
  }
  const step = body.match(/^#(\d+)\s+\[([^\]]+)\]/);
  if (step) {
    return {
      kind: 'progress',
      text: `building ${step[2]}`,
      status: { phase: 'build' },
      raw: line,
      source: 'buildkit',
    };
  }
  if (/^#\d+\s+(DONE|CACHED|exporting|writing image|extracting)/.test(body)) {
    return {
      kind: 'progress',
      status: { phase: 'build' },
      raw: line,
      source: 'buildkit',
    };
  }
  return noise(line, 'buildkit');
};
