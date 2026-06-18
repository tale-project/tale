/**
 * `docker compose` output classifier. Collapses image-pull layer churn and
 * health-check access logs to noise/progress, relabels container/network/volume
 * lifecycle lines to a clean status, and surfaces warnings/errors verbatim.
 *
 * Compose errors often carry no "error"/"failed" keyword (e.g. "network X
 * declared as external, but could not be found"), so the error branch matches
 * the common failure shapes too — erring toward surfacing.
 *
 * node-free.
 */

import { cleanComposeLine, HEALTH_CHECK } from '../internal';
import type { Classifier } from '../kinds';
import { noise } from '../kinds';

const DOCKER_LAYER =
  /^[0-9a-f]{12,}:\s+(Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/;
const DOCKER_LIFECYCLE =
  /^\s*(?:[⠿⠏⠋⠙⠹⠸⠼⠴⠦⠧⠇✔✓]\s*)?(Container|Network|Volume)\s+(\S+)\s+(Creating|Created|Starting|Started|Healthy|Running|Recreate|Recreated|Removing|Removed|Waiting|Stopping|Stopped)\b/;
const DOCKER_ERROR =
  /error|failed|could not|cannot|no such|denied|not found|declared as external|is not running/i;

export const classifyDockerCompose: Classifier = (line) => {
  if (HEALTH_CHECK.test(line)) return noise(line, 'docker-compose');
  const body = cleanComposeLine(line);
  if (DOCKER_LAYER.test(body)) {
    return {
      kind: 'progress',
      status: { phase: 'pull' },
      raw: line,
      source: 'docker-compose',
    };
  }
  const life = body.match(DOCKER_LIFECYCLE);
  if (life) {
    return {
      kind: 'info',
      text: `${life[2]} ${life[3].toLowerCase()}`,
      raw: line,
      source: 'docker-compose',
    };
  }
  if (/^Status: (Downloaded newer image|Image is up to date)/.test(body)) {
    return { kind: 'info', text: body, raw: line, source: 'docker-compose' };
  }
  if (/level=warning|^WARN/.test(body)) {
    return { kind: 'warn', text: body, raw: line, source: 'docker-compose' };
  }
  if (body.trim() !== '' && DOCKER_ERROR.test(body)) {
    return { kind: 'error', text: body, raw: line, source: 'docker-compose' };
  }
  return noise(line, 'docker-compose');
};
