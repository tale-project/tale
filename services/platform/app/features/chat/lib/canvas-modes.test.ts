import { describe, expect, it } from 'vitest';

import {
  defaultCanvasMode,
  resolveCanvasModes,
  type CanvasThreadFacts,
} from './canvas-modes';

function facts(overrides: Partial<CanvasThreadFacts> = {}): CanvasThreadFacts {
  return {
    kind: 'direct',
    hasSandboxSession: false,
    isComputerStreaming: false,
    activityCount: 0,
    fileCount: 0,
    artifactCount: 0,
    ...overrides,
  };
}

describe('resolveCanvasModes', () => {
  it('shows no mode for a direct thread that produced nothing', () => {
    expect(resolveCanvasModes(facts())).toEqual([]);
  });

  it('omits the sandbox modes on a direct thread even when it has artifacts', () => {
    const states = resolveCanvasModes(facts({ artifactCount: 2 }));

    expect(states.map((state) => state.mode)).toEqual(['browser']);
    expect(states[0].ready).toBe(true);
  });

  it('shows the three sandbox modes on a sandbox thread, in tab order', () => {
    const states = resolveCanvasModes(facts({ kind: 'sandbox' }));

    expect(states.map((state) => state.mode)).toEqual([
      'computer',
      'live',
      'file',
    ]);
  });

  it('explains every sandbox mode as not-started before a session exists', () => {
    const states = resolveCanvasModes(
      facts({ kind: 'sandbox', hasSandboxSession: false }),
    );

    for (const state of states) {
      expect(state.ready).toBe(false);
      expect(state.pending).toBe('sandbox-not-started');
    }
  });

  it('gives each sandbox mode its own reason once a session exists', () => {
    const states = resolveCanvasModes(
      facts({ kind: 'sandbox', hasSandboxSession: true }),
    );

    expect(states).toEqual([
      { mode: 'computer', ready: false, pending: 'computer-not-streaming' },
      { mode: 'live', ready: false, pending: 'no-activity' },
      { mode: 'file', ready: false, pending: 'no-files' },
    ]);
  });

  it('marks a sandbox mode ready as soon as it has content', () => {
    const states = resolveCanvasModes(
      facts({
        kind: 'sandbox',
        hasSandboxSession: true,
        isComputerStreaming: true,
        activityCount: 3,
        fileCount: 1,
      }),
    );

    expect(states).toEqual([
      { mode: 'computer', ready: true },
      { mode: 'live', ready: true },
      { mode: 'file', ready: true },
    ]);
  });

  it('never shows the browser mode without an artifact', () => {
    const withoutArtifacts = resolveCanvasModes(
      facts({ kind: 'sandbox', hasSandboxSession: true }),
    );
    expect(withoutArtifacts.some((s) => s.mode === 'browser')).toBe(false);

    const withArtifacts = resolveCanvasModes(
      facts({ kind: 'sandbox', hasSandboxSession: true, artifactCount: 1 }),
    );
    expect(withArtifacts.at(-1)).toEqual({ mode: 'browser', ready: true });
  });

  it('pairs every shown mode with exactly one of content or a reason', () => {
    const combinations: CanvasThreadFacts[] = [
      facts({ kind: 'sandbox' }),
      facts({ kind: 'sandbox', hasSandboxSession: true }),
      facts({ kind: 'sandbox', hasSandboxSession: true, fileCount: 4 }),
      facts({ kind: 'direct', artifactCount: 1 }),
    ];

    for (const combination of combinations) {
      for (const state of resolveCanvasModes(combination)) {
        if (state.ready) {
          expect(state.pending).toBeUndefined();
        } else {
          expect(state.pending).toBeDefined();
        }
      }
    }
  });
});

describe('defaultCanvasMode', () => {
  it('opens on the first mode with content', () => {
    const states = resolveCanvasModes(
      facts({
        kind: 'sandbox',
        hasSandboxSession: true,
        fileCount: 2,
        artifactCount: 1,
      }),
    );

    expect(defaultCanvasMode(states)).toBe('file');
  });

  it('falls back to the first shown mode when none has content', () => {
    const states = resolveCanvasModes(
      facts({ kind: 'sandbox', hasSandboxSession: true }),
    );

    expect(defaultCanvasMode(states)).toBe('computer');
  });

  it('returns nothing when the thread shows no mode at all', () => {
    expect(defaultCanvasMode(resolveCanvasModes(facts()))).toBeUndefined();
  });
});
