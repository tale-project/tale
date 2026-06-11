import { describe, expect, it } from 'vitest';

import { preflightTestRunInput } from './preflight_test_run_input';

const steps = [
  {
    stepType: 'start',
    config: {
      inputSchema: {
        properties: {
          email: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['email'],
      },
    },
  },
  { stepType: 'action', config: {} },
];

describe('preflightTestRunInput', () => {
  it('accepts input satisfying the start-node schema', () => {
    expect(
      preflightTestRunInput(steps, { email: 'a@b.c', count: 2 }),
    ).toBeNull();
  });

  it('reports missing required fields with field-specific messages', () => {
    const message = preflightTestRunInput(steps, {});
    expect(message).toContain('Invalid workflow input:');
    expect(message).toContain("Missing required parameter: 'email'");
  });

  it('reports type mismatches', () => {
    const message = preflightTestRunInput(steps, {
      email: 'a@b.c',
      count: 'two',
    });
    expect(message).toContain(
      "Parameter 'count' expected type 'number', got 'string'",
    );
  });

  it('joins multiple errors', () => {
    const message = preflightTestRunInput(steps, { count: 'two' });
    expect(message).toContain("Missing required parameter: 'email'");
    expect(message).toContain('; ');
    expect(message).toContain("Parameter 'count' expected type 'number'");
  });

  it('treats a non-record input as empty (required fields still enforced)', () => {
    const message = preflightTestRunInput(steps, 'not-an-object');
    expect(message).toContain("Missing required parameter: 'email'");
  });

  it('passes when the workflow declares no start schema', () => {
    expect(
      preflightTestRunInput([{ stepType: 'action', config: {} }], {}),
    ).toBeNull();
    expect(
      preflightTestRunInput([{ stepType: 'start', config: {} }], undefined),
    ).toBeNull();
  });
});
