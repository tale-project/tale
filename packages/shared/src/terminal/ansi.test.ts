import { describe, expect, it } from 'vitest';

import {
  ESC,
  makeMarkers,
  makePalette,
  matchAnsiAt,
  RESET,
  stripAnsi,
} from './ansi.ts';

describe('palette', () => {
  it('an off palette is all empty strings', () => {
    expect(Object.values(makePalette(false)).every((v) => v === '')).toBe(true);
  });

  it('an on palette carries the real SGR codes', () => {
    const p = makePalette(true);
    expect(p.reset).toBe('\x1b[0m');
    expect(p.bold).toBe('\x1b[1m');
    expect(p.dim).toBe('\x1b[2m');
    expect(p.red).toBe('\x1b[31m');
    expect(p.green).toBe('\x1b[32m');
    expect(p.yellow).toBe('\x1b[33m');
    expect(p.blue).toBe('\x1b[34m');
    expect(p.cyan).toBe('\x1b[36m');
  });

  it('RESET is the canonical reset code', () => {
    expect(RESET).toBe('\x1b[0m');
  });
});

describe('markers', () => {
  it('use a unicode glyph when available, ASCII fallback otherwise', () => {
    expect(makeMarkers(false).done).toBe('[ + ]');
    expect(makeMarkers(false).error).toBe('[ x ]');
    expect(makeMarkers(false).spinnerFrames).toContain('[ - ]');
    expect(makeMarkers(true).done).toBe('[ ✓ ]');
    expect(makeMarkers(true).error).toBe('[ ✗ ]');
  });

  it('spinner frames: 10 braille frames (unicode) vs 4 ASCII frames', () => {
    expect(makeMarkers(true).spinnerFrames).toHaveLength(10);
    expect(makeMarkers(false).spinnerFrames).toHaveLength(4);
  });
});

describe('safe ANSI builders', () => {
  it('cursor-up is relative and no-ops at 0 or below', () => {
    expect(ESC.up(0)).toBe('');
    expect(ESC.up(-1)).toBe('');
    expect(ESC.up(3)).toBe('\x1b[3A');
  });

  it('never exposes a full-screen clear or absolute move', () => {
    const all = JSON.stringify(ESC);
    expect(all).not.toContain('2J');
    expect(all).not.toMatch(/\d+;\d+H/);
    expect(all).not.toContain('[H');
  });
});

describe('stripAnsi', () => {
  it('strips SGR and cursor sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripAnsi('a\x1b[?25lb')).toBe('ab');
  });

  it('strips a mix of hide/show-cursor + SGR, leaving only text', () => {
    expect(stripAnsi('\x1b[?25l\x1b[1mhi\x1b[0m\x1b[?25h')).toBe('hi');
  });

  it('leaves a bare ESC with no CSI intact (not a full escape)', () => {
    expect(stripAnsi('a\x1bb')).toBe('a\x1bb');
  });
});

describe('matchAnsiAt', () => {
  it('returns the escape when one begins exactly at the index', () => {
    expect(matchAnsiAt('\x1b[31mX', 0)).toBe('\x1b[31m');
    expect(matchAnsiAt('X\x1b[0m', 1)).toBe('\x1b[0m');
  });

  it('returns null when no escape starts at the index', () => {
    expect(matchAnsiAt('abc', 0)).toBeNull();
    expect(matchAnsiAt('\x1b[31mX', 5)).toBeNull(); // points at "X"
  });

  it('is stateless across interleaved calls (no lastIndex leakage)', () => {
    const line = '\x1b[1mA\x1b[0m'; // [1m]=0..3, A=4, [0m]=5..8
    expect(matchAnsiAt(line, 0)).toBe('\x1b[1m');
    expect(matchAnsiAt(line, 4)).toBeNull(); // points at "A"
    expect(matchAnsiAt(line, 5)).toBe('\x1b[0m'); // after "A"
    expect(matchAnsiAt(line, 0)).toBe('\x1b[1m'); // repeatable
  });
});
