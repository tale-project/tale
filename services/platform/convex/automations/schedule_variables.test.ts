import { describe, expect, it } from 'vitest';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import {
  effectiveScheduleInput,
  isUnconfiguredScheduleValue,
  mergeScheduleVariables,
  missingRequiredScheduleFields,
  startInputSchemaOf,
} from './schedule_variables';

/** A minimal workflow whose start step declares the GitHub-style contract. */
const WORKFLOW: Pick<WorkflowJsonConfig, 'steps'> = {
  steps: [
    {
      stepSlug: 'start',
      name: 'Start',
      stepType: 'start',
      config: {
        inputSchema: {
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            projectId: { type: 'string' },
          },
          required: ['owner', 'repo', 'projectId'],
        },
      },
      nextSteps: {},
    },
  ],
};

describe('startInputSchemaOf', () => {
  it('extracts the start step inputSchema with its required list', () => {
    const schema = startInputSchemaOf(WORKFLOW);
    expect(schema?.required).toEqual(['owner', 'repo', 'projectId']);
    expect(Object.keys(schema?.properties ?? {})).toEqual([
      'owner',
      'repo',
      'projectId',
    ]);
  });

  it('returns undefined without a start step, schema, or workflow', () => {
    expect(startInputSchemaOf(undefined)).toBeUndefined();
    expect(startInputSchemaOf({ steps: [] })).toBeUndefined();
    expect(
      startInputSchemaOf({
        steps: [
          {
            stepSlug: 'start',
            name: 'Start',
            stepType: 'start',
            config: {},
            nextSteps: {},
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('tolerates a malformed required list (keeps only strings)', () => {
    const schema = startInputSchemaOf({
      steps: [
        {
          stepSlug: 'start',
          name: 'Start',
          stepType: 'start',
          config: {
            inputSchema: {
              properties: { owner: { type: 'string' } },
              required: ['owner', 42, null],
            },
          },
          nextSteps: {},
        },
      ],
    });
    expect(schema?.required).toEqual(['owner']);
  });
});

describe('isUnconfiguredScheduleValue', () => {
  it('treats absent, null, blank strings, and empty collections as unconfigured', () => {
    expect(isUnconfiguredScheduleValue(undefined)).toBe(true);
    expect(isUnconfiguredScheduleValue(null)).toBe(true);
    expect(isUnconfiguredScheduleValue('')).toBe(true);
    expect(isUnconfiguredScheduleValue('   ')).toBe(true);
    expect(isUnconfiguredScheduleValue([])).toBe(true);
    expect(isUnconfiguredScheduleValue({})).toBe(true);
  });

  it('accepts 0, false, and real values as configured', () => {
    expect(isUnconfiguredScheduleValue(0)).toBe(false);
    expect(isUnconfiguredScheduleValue(false)).toBe(false);
    expect(isUnconfiguredScheduleValue('acme')).toBe(false);
    expect(isUnconfiguredScheduleValue(['a'])).toBe(false);
    expect(isUnconfiguredScheduleValue({ a: 1 })).toBe(false);
  });
});

describe('mergeScheduleVariables', () => {
  it('keeps operator-filled values over the desired defaults', () => {
    expect(
      mergeScheduleVariables(
        { owner: 'file-owner', projectId: 'p1' },
        { owner: 'acme', repo: 'widgets' },
      ),
    ).toEqual({ owner: 'acme', repo: 'widgets', projectId: 'p1' });
  });

  it('lets a desired default replace a blank placeholder (#2607)', () => {
    expect(
      mergeScheduleVariables(
        { projectId: 'p1', repo: 'file-default' },
        { owner: 'acme', repo: '', projectId: '' },
      ),
    ).toEqual({ owner: 'acme', repo: 'file-default', projectId: 'p1' });
  });

  it('keeps a blank row value when there is no configured default for it', () => {
    expect(mergeScheduleVariables({}, { repo: '' })).toEqual({ repo: '' });
    expect(mergeScheduleVariables({ repo: '' }, { repo: null })).toEqual({
      repo: null,
    });
  });

  it('handles absent sides', () => {
    expect(mergeScheduleVariables(undefined, undefined)).toEqual({});
    expect(mergeScheduleVariables({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeScheduleVariables(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('effectiveScheduleInput', () => {
  it('fills projectId from the schedule row when the variables leave it blank', () => {
    expect(
      effectiveScheduleInput({ owner: 'acme', projectId: '' }, 'p1'),
    ).toEqual({ owner: 'acme', projectId: 'p1' });
    expect(effectiveScheduleInput(undefined, 'p1')).toEqual({
      projectId: 'p1',
    });
  });

  it('never overrides an operator-set projectId and adds none without a row project', () => {
    expect(effectiveScheduleInput({ projectId: 'chosen' }, 'p1')).toEqual({
      projectId: 'chosen',
    });
    expect(effectiveScheduleInput({ owner: 'acme' }, undefined)).toEqual({
      owner: 'acme',
    });
  });
});

describe('missingRequiredScheduleFields', () => {
  const schema = startInputSchemaOf(WORKFLOW);

  it('names required fields that are absent or blank', () => {
    expect(
      missingRequiredScheduleFields(schema, { owner: 'acme', repo: '' }),
    ).toEqual(['repo', 'projectId']);
    expect(missingRequiredScheduleFields(schema, undefined)).toEqual([
      'owner',
      'repo',
      'projectId',
    ]);
  });

  it('returns [] when everything is configured or nothing is required', () => {
    expect(
      missingRequiredScheduleFields(schema, {
        owner: 'acme',
        repo: 'widgets',
        projectId: 'p1',
      }),
    ).toEqual([]);
    expect(missingRequiredScheduleFields(undefined, {})).toEqual([]);
  });
});
