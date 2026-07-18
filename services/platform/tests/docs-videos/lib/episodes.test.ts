import { describe, expect, it } from 'vitest';

import { loadChoreography, loadEpisodes } from './episodes';
import {
  formatFindings,
  validateChoreography,
  validateEpisodeSpec,
  type ValidationFinding,
} from './validate';

/**
 * The always-on episode gate: every episode the registry discovers must pass
 * static validation — spec ↔ choreography id parity, locale consistency,
 * hero-prompt ↔ DOCS_REPLIES pairing, warmup presence. This is the same
 * validation `--stage check` runs; here it fails `bun run check` the moment
 * an episode drifts, instead of minutes into a take.
 */
describe('episode registry gate', () => {
  it('discovers the full series in natural order', async () => {
    const ids = (await loadEpisodes()).map((episode) => episode.id);
    expect(ids).toContain('ep1-welcome');
    expect(ids).toContain('spike-sync');
    expect(ids.length).toBeGreaterThanOrEqual(11);
    expect(ids.indexOf('ep2-chat')).toBeLessThan(
      ids.indexOf('ep10-developers'),
    );
  });

  it('every episode passes static validation (spec + choreography)', async () => {
    const errors: ValidationFinding[] = [];
    for (const episode of await loadEpisodes()) {
      const findings = [
        ...validateEpisodeSpec(episode),
        ...validateChoreography(episode, await loadChoreography(episode.id)),
      ];
      errors.push(...findings.filter((f) => f.severity === 'error'));
      const warnings = findings.filter((f) => f.severity === 'warning');
      if (warnings.length > 0) {
        console.warn(`${episode.id}:\n${formatFindings(warnings)}`);
      }
    }
    expect(
      errors.map((finding) => `${finding.where}: ${finding.detail}`),
    ).toEqual([]);
  });
});
