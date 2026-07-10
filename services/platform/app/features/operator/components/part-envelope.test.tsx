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

/** The park-on-capacity handoff envelope a queued sandbox step persists — never
 * a real result. It must surface a "Queued for capacity" affordance, never leak
 * as raw JSON (the reported bug) and never read as a "Done" output. */
const AWAITING_CAPACITY_ENVELOPE = {
  mode: 'agent',
  ok: false,
  outputFileIds: [],
  status: 'awaiting_capacity',
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

  it('shows a queued affordance and NOT the raw awaiting_capacity envelope for a parked step', () => {
    render(
      <PartEnvelope
        part={part({
          partState: 'queued_capacity',
          data: AWAITING_CAPACITY_ENVELOPE,
        })}
      >
        <RenderKindRouter
          part={part({
            partState: 'queued_capacity',
            data: AWAITING_CAPACITY_ENVELOPE,
          })}
        />
      </PartEnvelope>,
    );

    // The park envelope must NOT leak as raw JSON (the reported bug) — the
    // queued_capacity body affordance replaces it.
    expect(screen.queryByText(/awaiting_capacity/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"status"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/outputFileIds/)).not.toBeInTheDocument();
  });

  it('still renders the render-kind body for an available output when expanded', async () => {
    const { user } = render(
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

    // output_available defaults to collapsed — expand to see the body.
    await user.click(
      screen.getByRole('button', { name: /Implement the fix/i }),
    );
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('defaults output_available to collapsed', () => {
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
    expect(screen.queryByText('done')).not.toBeInTheDocument();
  });

  it('keeps waiting_human expanded under auto', () => {
    render(
      <PartEnvelope
        part={part({
          partState: 'waiting_human',
          render: 'review',
          data: { mode: 'gate' },
        })}
      >
        <div>needs approval</div>
      </PartEnvelope>,
    );
    expect(screen.getByText('needs approval')).toBeInTheDocument();
  });
});
