import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { RenderPart } from '../../types';
import { StreamPanel } from './stream-panel';

/** The sandbox node envelope a running durable step carries before its result
 * lands — exactly what used to leak as raw JSON after a refresh. */
const RUNNING_ENVELOPE = {
  durationMs: 362701,
  mode: 'agent',
  ok: false,
  outputFileIds: [],
  status: 'running',
};

function streamPart(overrides: Partial<RenderPart>): RenderPart {
  return {
    render: 'stream',
    partState: 'running',
    title: 'Implement the fix',
    data: RUNNING_ENVELOPE,
    ...overrides,
  };
}

describe('StreamPanel', () => {
  it('renders the live working state for a running step with no parts yet — never the raw envelope', () => {
    render(<StreamPanel part={streamPart({ partState: 'running' })} />);
    // The live feed takes over: a "Live" badge (empty parts → thinking dots).
    expect(screen.getByText('Live')).toBeInTheDocument();
    // The internal {status:'running'} envelope must NOT be dumped as JSON.
    expect(screen.queryByText(/durationMs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"status"/)).not.toBeInTheDocument();
  });

  it('renders the live transcript when a running step has parts', () => {
    render(
      <StreamPanel
        part={streamPart({
          partState: 'running',
          liveParts: [
            { type: 'text', text: 'cloning the repo', state: 'done' },
          ],
        })}
      />,
    );
    expect(screen.getByText('cloning the repo')).toBeInTheDocument();
    expect(screen.queryByText(/durationMs/)).not.toBeInTheDocument();
  });

  it('a TERMINAL step with no renderable output falls back to OutputFallback, not a live state (no regression)', () => {
    // `data: undefined` exercises the OutputFallback path synchronously (its
    // JsonViewer branch lazy-loads a highlighter, async in jsdom). The point is
    // the GATE: a terminal step must not take the live branch.
    render(
      <StreamPanel
        part={streamPart({ partState: 'output_available', data: undefined })}
      />,
    );
    expect(screen.getByText('No details to show.')).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('a TERMINAL step never shows the live working state for a raw envelope', () => {
    render(
      <StreamPanel
        part={streamPart({
          partState: 'output_available',
          data: { unexpectedShape: 'value-xyz' },
        })}
      />,
    );
    // The gate: terminal → not the live branch (and not blank — OutputFallback
    // renders the JsonViewer, whose async content we don't assert here).
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('a terminal step with a summary shows the summary, not raw JSON', () => {
    render(
      <StreamPanel
        part={streamPart({
          partState: 'output_available',
          data: { summary: 'Opened PR #42; CI green.' },
        })}
      />,
    );
    expect(screen.getByText('Opened PR #42; CI green.')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe for the running working state', async () => {
      const { container } = render(
        <StreamPanel part={streamPart({ partState: 'running' })} />,
      );
      await checkAccessibility(container);
    });
  });
});
