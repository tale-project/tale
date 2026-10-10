import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Issue } from '@/lib/engine/core/types';

import { defaultTriggerDraft, type TriggerDraft } from '../lib/trigger-draft';
import { useTriggerInputCheck } from './use-trigger-input-check';

/** The GitHub triage pack's inputs: owner and repo, which a schedule never
 * sends. */
const GITHUB_INPUTS = {
  type: 'object',
  required: ['owner', 'repo'],
  properties: { owner: { type: 'string' }, repo: { type: 'string' } },
};

/** A webhook automation that reads a typed body. */
const WEBHOOK_INPUTS = {
  type: 'object',
  required: ['payload'],
  properties: {
    payload: {
      type: 'object',
      required: ['issueId'],
      properties: { issueId: { type: 'string' } },
    },
  },
};

const NO_WARNINGS: readonly Issue[] = [];

function draft(overrides: Partial<TriggerDraft>): TriggerDraft {
  return { ...defaultTriggerDraft('Europe/Zurich'), ...overrides };
}

function check(
  value: TriggerDraft,
  options: {
    inputsSchema?: Record<string, unknown>;
    deployed?: boolean;
    clean?: boolean;
    saveWarnings?: readonly Issue[];
  } = {},
) {
  return renderHook(() =>
    useTriggerInputCheck({
      draft: value,
      stored: null,
      inputsSchema: options.inputsSchema,
      deployed: options.deployed ?? true,
      clean: options.clean ?? false,
      saveWarnings: options.saveWarnings ?? NO_WARNINGS,
    }),
  ).result.current;
}

describe('useTriggerInputCheck', () => {
  it('samples a schedule at its next start, with the fixed input under the trigger’s fields', () => {
    const result = check(
      draft({ input: '{"owner": "acme", "repo": "tale"}' }),
      {
        inputsSchema: GITHUB_INPUTS,
      },
    );
    expect(result.input).toEqual({
      owner: 'acme',
      repo: 'tale',
      trigger: 'schedule',
      firedAt: result.firedAt,
    });
    // The default rule: every day at 09:00 in Zurich, so a start ahead.
    expect(result.firedAt).toBeGreaterThan(Date.now());
    expect(result.verdict).toEqual({ kind: 'accepted' });
    expect(result.missing).toEqual([]);
  });

  // Ada's GitHub triage schedule sends neither owner nor repo: version 3
  // would refuse every start, and the fixed input is where they go.
  it('names what the deployed inputs need that the trigger does not send', () => {
    const result = check(draft({}), { inputsSchema: GITHUB_INPUTS });
    expect(result.verdict).toEqual({
      kind: 'refused',
      paths: ['owner', 'repo'],
    });
    expect(result.missing).toEqual([
      { name: 'owner', type: 'string' },
      { name: 'repo', type: 'string' },
    ]);
  });

  it('does not hold a webhook’s unknown body against it', () => {
    const result = check(draft({ kind: 'webhook' }), {
      inputsSchema: WEBHOOK_INPUTS,
    });
    expect(result.input).toEqual({
      trigger: 'webhook',
      payload: { example: true },
    });
    expect(result.firedAt).toBeNull();
    expect(result.verdict).toEqual({ kind: 'accepted' });
  });

  it('samples an event with its example payload, and nothing before one is picked', () => {
    expect(check(draft({ kind: 'event', event: '' })).input).toBeNull();
    const result = check(draft({ kind: 'event', event: 'task.created' }));
    expect(result.input).toMatchObject({
      trigger: 'event',
      event: 'task.created',
    });
  });

  it('checks nothing while no version is deployed', () => {
    expect(
      check(draft({}), { inputsSchema: GITHUB_INPUTS, deployed: false })
        .verdict,
    ).toBeNull();
  });

  it('goes on without a fixed input that does not read', () => {
    const result = check(draft({ input: '{"owner": ' }), {
      inputsSchema: GITHUB_INPUTS,
    });
    expect(result.input).not.toHaveProperty('owner');
  });

  it('takes the last save’s word while the form is what it saved', () => {
    const mismatch: Issue = {
      level: 'warning',
      code: 'TRIGGER_INPUT_MISMATCH',
      message: 'The schedule starts runs without owner.',
      params: { kind: 'schedule', missing: ['owner'] },
    };
    const clean = check(draft({ input: '{"owner": "a", "repo": "b"}' }), {
      inputsSchema: GITHUB_INPUTS,
      clean: true,
      saveWarnings: [mismatch],
    });
    expect(clean.verdict).toEqual({ kind: 'refused', paths: ['owner'] });
    expect(clean.warnings).toEqual([mismatch]);
    // An edit since the save: the client's own check, and no stale words.
    const edited = check(draft({ input: '{"owner": "a", "repo": "b"}' }), {
      inputsSchema: GITHUB_INPUTS,
      clean: false,
      saveWarnings: [mismatch],
    });
    expect(edited.verdict).toEqual({ kind: 'accepted' });
    expect(edited.warnings).toEqual([]);
  });
});
