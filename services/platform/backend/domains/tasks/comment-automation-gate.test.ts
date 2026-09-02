/**
 * Only a human's comment starts the automation that owns the task.
 *
 * 0.4 reached the trigger from `applyUserTaskComment` alone. 0.5 merged the
 * user and agent doors into one `addTaskComment`, so an agent- or
 * workflow-authored comment naming the owning automation restarted the engine
 * that wrote it — a sequential loop of metered agent turns. The one-live-run
 * guard does not catch that: it blocks a CONCURRENT second start, not a later
 * one.
 *
 * The rule is asserted directly, and the wiring is asserted by reading the
 * source: driving it through `addTaskComment` would need ten mocked
 * collaborators, and the mock scaffold would break on the next refactor
 * without the rule ever changing. The end-to-end lane lives in
 * `integration-check.ts`.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { commentCanStartAutomation } from './comments.ts';

describe('commentCanStartAutomation', () => {
  it('admits a human comment', () => {
    expect(commentCanStartAutomation('user')).toBe(true);
  });

  // The actor types that reach `addTaskComment` through the merged door.
  for (const authorType of ['agent', 'workflow', 'system', 'api', '']) {
    it(`refuses ${authorType === '' ? '<empty>' : authorType}`, () => {
      expect(commentCanStartAutomation(authorType)).toBe(false);
    });
  }
});

describe('the gate is wired into the trigger', () => {
  const source = readFileSync(
    new URL('./comments.ts', import.meta.url),
    'utf8',
  );

  it('gates the trigger on the rule', () => {
    const trigger = source.slice(
      source.indexOf('async function maybeTriggerOwningAutomation('),
    );
    const body = trigger.slice(0, trigger.indexOf('\n}'));

    expect(body).toContain('commentCanStartAutomation(args.authorType)');
  });

  it('threads the comment author into the trigger call', () => {
    // Two call sites pass `authorType` — this one and the agent-instance
    // steer below it — so pin THIS one. Hard-coding it would silently
    // disable the gate, and dropping it would refuse every comment.
    const call = source.slice(
      source.indexOf('await maybeTriggerOwningAutomation(tx, {'),
    );
    const args = call.slice(0, call.indexOf('});'));

    expect(args).toContain('authorType: author.actorType');
  });
});
