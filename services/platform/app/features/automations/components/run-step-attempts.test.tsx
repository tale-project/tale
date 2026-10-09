import { describe, expect, it } from 'vitest';

import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { RunStepAttempts } from './run-step-attempts';

function step(attempts: RecordedStep['attempts']): RecordedStep {
  return {
    path: 'send',
    nodeId: 'send',
    type: 'github.create_issue',
    status: 'succeeded',
    activeMs: 10,
    waitedMs: 0,
    attempt: attempts.length,
    attempts,
    decisions: [],
    waits: [],
    meta: {},
  };
}

describe('RunStepAttempts', () => {
  it('lists each try, a restart that cut one short, and why one failed', () => {
    render(
      <RunStepAttempts
        step={step([
          { n: 1, startedAt: 1, endedAt: 2, outcome: 'interrupted' },
          {
            n: 2,
            startedAt: 3,
            endedAt: 4,
            outcome: 'failed',
            failureCode: 'connector_error',
            reason: 'CONNECTOR_RATE_LIMITED',
          },
          { n: 3, startedAt: 5, endedAt: 6, outcome: 'ok' },
        ])}
      />,
    );
    expect(screen.getByText('Attempts')).toBeVisible();
    expect(screen.getByText('Interrupted by a restart')).toBeVisible();
    expect(screen.getByText('The service asked to slow down')).toBeVisible();
    expect(screen.getByText('Done')).toBeVisible();
  });

  it('passes an axe audit', async () => {
    const { container } = render(
      <RunStepAttempts
        step={step([
          { n: 1, startedAt: 1, endedAt: 2, outcome: 'interrupted' },
          { n: 2, startedAt: 3, endedAt: 4, outcome: 'ok' },
        ])}
      />,
    );
    await checkAccessibility(container);
  });

  it('says nothing for a step that ran once', () => {
    const { container } = render(
      <RunStepAttempts
        step={step([{ n: 1, startedAt: 1, endedAt: 2, outcome: 'ok' }])}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
