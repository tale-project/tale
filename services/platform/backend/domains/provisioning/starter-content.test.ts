import { describe, expect, it } from 'vitest';

import { EXAMPLE_TASKS } from './starter-content.ts';

/**
 * The seeded copy is the first thing a new customer reads. Regression: the
 * integration → connector rename left "Connect an connector" as a starter
 * task title in every freshly provisioned organization.
 */
describe('starter content copy', () => {
  const copy = EXAMPLE_TASKS.flatMap((task) => [task.title, task.description]);

  it('never pairs "an" with a consonant-initial word', () => {
    for (const text of copy) {
      expect(text).not.toMatch(/\ban (?=[b-df-hj-np-tv-z])/i);
    }
  });

  it('names the connector task with the right article', () => {
    expect(EXAMPLE_TASKS.map((task) => task.title)).toContain(
      'Connect a connector',
    );
  });

  it('never writes a bare @mention that would fire a phantom event', () => {
    for (const text of copy) {
      expect(text).not.toMatch(/@\w/);
    }
  });
});
