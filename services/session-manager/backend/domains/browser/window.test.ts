import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SCREEN_SCRIPT,
  activateScript,
  activateWindow,
  largestDisplay,
} from './window.ts';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('activateScript', () => {
  it('activates the app of the process, with all its windows', () => {
    const script = activateScript(4321);
    expect(script).toContain('runningApplicationWithProcessIdentifier(4321)');
    expect(script).toContain('activateWithOptions(3)');
  });
});

describe('activateWindow', () => {
  it('asks nothing where there is no AppKit', async () => {
    expect(await activateWindow(4321, 'linux')).toBe(false);
    expect(await activateWindow(4321, 'win32')).toBe(false);
  });

  it('asks nothing for what is no process id', async () => {
    expect(await activateWindow(0, 'darwin')).toBe(false);
    expect(await activateWindow(-1, 'darwin')).toBe(false);
    expect(await activateWindow(1.5, 'darwin')).toBe(false);
    expect(await activateWindow(Number.NaN, 'darwin')).toBe(false);
  });
});

describe('largestDisplay', () => {
  it('reads the size the script tells', () => {
    const run = vi.fn((_script: string) => '1728x1117\n');
    expect(largestDisplay('darwin', run)).toEqual([1728, 1117]);
    expect(run).toHaveBeenCalledWith(SCREEN_SCRIPT);
  });

  it('answers null where it cannot be asked', () => {
    const run = vi.fn((_script: string) => '1728x1117');
    expect(largestDisplay('linux', run)).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('answers null when the answer is no size', () => {
    expect(largestDisplay('darwin', () => '0x0')).toBeNull();
    expect(largestDisplay('darwin', () => 'undefinedxundefined')).toBeNull();
    expect(largestDisplay('darwin', () => '')).toBeNull();
  });

  it('answers null, with a warning, when the script fails', () => {
    const failing = (): string => {
      throw new Error('osascript: timed out');
    };
    expect(largestDisplay('darwin', failing)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      'could not tell the size of the screen',
      expect.any(Error),
    );
  });
});
