import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { RenderPart } from '../types';
import { PartEnvelope } from './part-envelope';
import { RenderKindRouter } from './render-kind-router';

/** The in-flight sandbox handoff envelope a durable step persists between
 * segments — never a real result. After a Stop it is the abandoned step's last
 * stored output, which must never leak as raw JSON. */
const RUNNING_ENVELOPE = {
  durationMs: 725441,
  mode: 'agent',
  ok: false,
  outputFileIds: [],
  status: 'running',
};

function part(overrides: Partial<RenderPart>): RenderPart {
  return {
    render: 'stream',
    partState: 'output_error',
    title: 'Implement the fix',
    data: RUNNING_ENVELOPE,
    ...overrides,
  };
}

describe('PartEnvelope', () => {
  it('shows the error message and NOT the raw output body for a canceled/failed step', () => {
    render(
      <PartEnvelope
        part={part({ partState: 'output_error', error: 'Cancelled by user' })}
      >
        <RenderKindRouter
          part={part({ partState: 'output_error', error: 'Cancelled by user' })}
        />
      </PartEnvelope>,
    );

    // The error message is the affordance for a settled-error step.
    expect(screen.getByText('Cancelled by user')).toBeInTheDocument();
    // The abandoned step's raw handoff envelope must NOT be dumped as JSON.
    expect(screen.queryByText(/durationMs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"status"/)).not.toBeInTheDocument();
  });

  it('still renders the render-kind body for an available output', () => {
    render(
      <PartEnvelope
        part={part({
          partState: 'output_available',
          data: { summary: 'done' },
        })}
      >
        <RenderKindRouter
          part={part({
            partState: 'output_available',
            data: { summary: 'done' },
          })}
        />
      </PartEnvelope>,
    );

    expect(screen.getByText('done')).toBeInTheDocument();
  });
});
