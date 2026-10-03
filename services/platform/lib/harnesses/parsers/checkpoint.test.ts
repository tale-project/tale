import { describe, expect, it } from 'vitest';

import { loadHarnesses } from '../../../backend/core/lib/providers/load_system_config';
import { getHarnessGlue } from '../registry';
import { collectEvents, readFixture } from '../test-helpers';
import { HARNESS_SLUGS, type HarnessEvent } from '../types';

describe('parser checkpoints', () => {
  it.each(HARNESS_SLUGS)(
    '%s survives serialized state at every chunk boundary',
    (slug) => {
      const glue = getHarnessGlue(slug, loadHarnesses());
      const fixture = {
        'claude-code': 'issue-to-pr',
        'claude-code-compact': 'issue-to-pr',
        cursor: 'issue-to-pr',
        hermes: 'issue-to-pr',
        openclaw: 'hello-turn',
        opencode: 'completed-tool-turn',
        'qwen-code': 'authentication-error-turn',
        codex: 'shell-turn',
        gemini: 'shell-turn',
        pi: 'shell-turn',
      }[slug];
      const text = readFixture(
        slug === 'claude-code-compact' ? 'claude-code' : slug,
        fixture,
      );
      const expected = collectEvents(glue.createParser(), text);
      let parser = glue.createParser();
      const actual: HarnessEvent[] = [];
      for (let offset = 0; offset < text.length; offset += 37) {
        actual.push(...parser.feed(text.slice(offset, offset + 37)));
        const checkpoint: unknown = JSON.parse(
          JSON.stringify(parser.snapshot()),
        );
        parser = glue.createParser();
        parser.restore(checkpoint);
      }
      actual.push(...parser.end());
      expect(actual).toEqual(expected);
    },
  );

  it.each(HARNESS_SLUGS)(
    '%s rejects malformed checkpoints instead of resetting accounting',
    (slug) => {
      const parser = getHarnessGlue(slug, loadHarnesses()).createParser();
      expect(() => parser.restore({ lines: 42 })).toThrow();
    },
  );
});
