import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCapabilities } from '../terminal/index.ts';
import { configureReporter, setReporterLevel } from './context.ts';
import { runStep, StepWarning } from './step.ts';

let out: string[];
let err: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

const all = (): string => out.join('') + err.join('');

beforeEach(() => {
  out = [];
  err = [];
  outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
  errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      err.push(String(chunk));
      return true;
    });
  configureReporter(detectCapabilities({ isTTY: false, env: {} }));
  setReporterLevel('normal');
});

afterEach(() => {
  setReporterLevel('normal');
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe('runStep (plain / non-interactive)', () => {
  it('ends in done and returns the result', async () => {
    const result = await runStep('Doing thing', async () => 42);
    expect(result).toBe(42);
    expect(out.join('')).toContain('[ - ] Doing thing...');
    expect(out.join('')).toMatch(/\[ \+ \] Doing thing \(/);
    expect(out.join('')).not.toContain('\x1b');
  });

  it('uses the active label running and the done label finished', async () => {
    await runStep(
      { active: 'Starting thing', done: 'Thing started' },
      async () => 1,
    );
    expect(out.join('')).toContain('[ - ] Starting thing...');
    expect(out.join('')).toMatch(/\[ \+ \] Thing started \(/);
  });

  it('ends in warn (degraded) on StepWarning without rethrowing', async () => {
    const result = await runStep('Optional thing', async () => {
      throw new StepWarning('unavailable, continuing');
    });
    expect(result).toBeUndefined();
    expect(out.join('')).toContain(
      '[ ! ] Optional thing — unavailable, continuing',
    );
  });

  it('ends in error and rethrows on a hard failure', async () => {
    await expect(
      runStep('Boom', async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');
    expect(err.join('')).toContain('[ x ] Boom');
  });

  it('shows no success terminal under --quiet', async () => {
    setReporterLevel('quiet');
    const result = await runStep('Quiet thing', async () => 7);
    expect(result).toBe(7);
    expect(out.join('')).toBe('');
  });
});

describe('runStep (interactive)', () => {
  beforeEach(() => {
    configureReporter(
      detectCapabilities({ isTTY: true, env: { LANG: 'en_US.UTF-8' } }),
    );
  });

  it('renders a spinner then a done terminal, restoring the cursor, no banned escapes', async () => {
    const result = await runStep(
      { active: 'Booting', done: 'Booted' },
      async () => 9,
    );
    expect(result).toBe(9);
    expect(all()).toContain('Booted');
    expect(all()).toContain('[ ✓ ]');
    expect(all()).toContain('\x1b[?25h'); // cursor restored on dispose
    expect(all()).not.toContain('\x1b[2J'); // never a full-screen clear
    expect(all()).not.toMatch(/\x1b\[\d+;\d+H/); // never absolute positioning
  });

  it('disposes the region (restores cursor) before rethrowing an error', async () => {
    await expect(
      runStep('Crash', async () => {
        throw new Error('kaboom');
      }),
    ).rejects.toThrow('kaboom');
    expect(all()).toContain('\x1b[?25h'); // cursor restored despite the throw
    expect(all()).toContain('[ ✗ ]'); // error marker (unicode profile)
  });

  it('leaves a clean context after a step (next step is independent)', async () => {
    await runStep('First', async () => 1);
    out = [];
    err = [];
    await runStep('Second', async () => 2);
    expect(all()).toContain('Second');
  });
});
