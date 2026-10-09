import { describe, expect, it } from 'vitest';

import type { RecordedStep } from '@/app/lib/backend/contract/automations';
import { render, screen, within } from '@/tests/utils/render';

import { RunStepConditions } from './run-step-conditions';

const AMOUNT = '{{ input.amount > 1000 }}';

function step(over: Partial<RecordedStep>): RecordedStep {
  return {
    path: 'score',
    nodeId: 'score',
    type: 'llm',
    status: 'skipped',
    activeMs: 0,
    waitedMs: 0,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...over,
  };
}

/** The `when` of Score, false: the run input's amount was 250. */
const SKIPPED = step({
  skip: { reason: 'when', at: 1200, chain: [] },
  decisions: [
    {
      kind: 'when',
      result: false,
      value: { kind: 'boolean', text: 'false' },
      trace: { pointer: '/nodes/1/when', units: [] },
      at: 1200,
      source: AMOUNT,
      explanation: [
        {
          range: [3, 22],
          source: 'input.amount > 1000',
          kind: 'compare',
          op: '>',
          value: { kind: 'boolean', text: 'false' },
          evaluated: true,
          children: [
            {
              range: [3, 15],
              source: 'input.amount',
              kind: 'ref',
              value: { kind: 'number', text: '250' },
              evaluated: true,
              children: [],
            },
          ],
        },
      ],
    },
  ],
});

describe('RunStepConditions', () => {
  it('says why a step was skipped, and how its condition came out with what it read', () => {
    render(<RunStepConditions step={SKIPPED} />);
    expect(
      screen.getByText('Score was skipped because its condition was false.'),
    ).toBeVisible();
    expect(screen.getByText('Only if')).toBeVisible();
    expect(
      screen.getByText(
        'amount of the run input (250) is not greater than 1,000',
      ),
    ).toBeVisible();
    expect(screen.getByText('No')).toBeVisible();
  });

  it('says a step ran because its condition held', () => {
    render(
      <RunStepConditions
        step={step({
          status: 'succeeded',
          decisions: [
            {
              kind: 'when',
              result: true,
              value: { kind: 'boolean', text: 'true' },
              trace: { pointer: '/nodes/1/when', units: [] },
              at: 1200,
              source: AMOUNT,
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText('Score ran because its condition was true.'),
    ).toBeVisible();
    expect(
      screen.getByText('amount of the run input is greater than 1,000'),
    ).toBeVisible();
    expect(screen.getByText('Yes')).toBeVisible();
  });

  it('names the step a skipped step stood aside for', () => {
    render(
      <RunStepConditions
        step={step({
          skip: { reason: 'else', via: ['triage'], at: 1200, chain: [] },
          decisions: [
            {
              kind: 'else',
              partner: 'triage',
              partnerSkippedByWhen: false,
              result: false,
              at: 1200,
            },
          ],
        })}
      />,
    );
    expect(
      screen.getByText('Score was skipped because Triage ran.'),
    ).toBeVisible();
  });

  it('shows a condition written as code as code', () => {
    const raw = '{{ Object.keys(input).length % 2 === 1 }}';
    render(
      <RunStepConditions
        step={step({
          status: 'succeeded',
          decisions: [
            {
              kind: 'when',
              result: true,
              value: { kind: 'boolean', text: 'true' },
              trace: { pointer: '/nodes/1/when', units: [] },
              at: 1200,
              source: raw,
            },
          ],
        })}
      />,
    );
    const card = screen.getByText('Only if').closest('div')?.parentElement;
    if (!card) throw new Error('no card');
    expect(
      within(card).getByText('This condition is written as code.'),
    ).toBeVisible();
    expect(within(card).getByText(raw)).toBeVisible();
  });

  it('says nothing for a step nothing decided', () => {
    const { container } = render(
      <RunStepConditions step={step({ status: 'succeeded' })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
