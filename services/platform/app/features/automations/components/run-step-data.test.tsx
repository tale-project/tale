import { describe, expect, it } from 'vitest';

import type { NodeRunDetail } from '@/app/lib/backend/contract/automations';
import { render, screen } from '@/tests/utils/render';

import { RunStepData } from './run-step-data';

function detail(over: Partial<NodeRunDetail> = {}): NodeRunDetail {
  return {
    path: 'score',
    nodeId: 'score',
    type: 'llm',
    status: 'succeeded',
    activeMs: 1200,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    reads: [],
    readsTotal: 0,
    ...over,
  } as NodeRunDetail;
}

const read = (
  from: NodeRunDetail['reads'][number]['from'],
  refPath: Array<string | number>,
  value: NodeRunDetail['reads'][number]['value'],
  start: number,
): NodeRunDetail['reads'][number] =>
  ({
    from,
    to: {
      path: 'score',
      field: 'prompt',
      pointer: '/nodes/2/prompt',
      range: [start, start + 10],
    },
    refPath,
    at: 1200,
    ...(value !== undefined && { value }),
    edge: { source: 'issues', target: 'score', kind: 'data' },
  }) as NodeRunDetail['reads'][number];

describe('RunStepData', () => {
  it('says what the step read, in words with the value it read', () => {
    render(
      <RunStepData
        detail={detail({
          reads: [
            read(
              { kind: 'node', nodeId: 'open_issues' },
              ['issues'],
              {
                kind: 'array',
                length: 12,
              },
              3,
            ),
            read(
              { kind: 'input' },
              ['amount'],
              { kind: 'number', text: '250' },
              20,
            ),
            // The same read again is listed once.
            read(
              { kind: 'input' },
              ['amount'],
              { kind: 'number', text: '250' },
              40,
            ),
          ],
          readsTotal: 3,
        })}
      />,
    );
    expect(screen.getByText('What was read')).toBeVisible();
    expect(screen.getByText('issues of Open issues: 12 items')).toBeVisible();
    expect(screen.getByText('amount of the run input: 250')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows what the step received and returned, and says what was cut or hidden', () => {
    render(
      <RunStepData
        detail={detail({
          input: {
            value: { prompt: 'Score these issues' },
            summary: { kind: 'object', keys: 1 },
            shape: {},
            bytes: 30,
            hash: 'h1',
            redacted: [{ pointer: '/apiKey', kind: 'secret' }],
          },
          output: {
            summary: { kind: 'array', length: 400 },
            shape: {},
            bytes: 9_000_000,
            hash: null,
          },
        } as Partial<NodeRunDetail>)}
      />,
    );
    expect(screen.getByText('Received')).toBeVisible();
    expect(screen.getByText('Secrets are hidden.')).toBeVisible();
    expect(screen.getByText('Returned')).toBeVisible();
    // Too large to keep: the summary in words stands in for the value.
    expect(screen.getByText('400 items')).toBeVisible();
  });

  it('says a step that did not run has no data', () => {
    render(<RunStepData detail={detail({ status: 'skipped' })} />);
    expect(
      screen.getByText("This step didn't run, so there's no data."),
    ).toBeVisible();
  });
});
