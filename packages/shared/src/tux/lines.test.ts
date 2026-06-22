import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCapabilities } from '../terminal/index.ts';
import {
  configureReporter,
  setReporterLevel,
  setReporterSilent,
} from './context.ts';
import {
  bannerText,
  debugLine,
  detailLines,
  doneLine,
  errorLine,
  infoLine,
  questionLine,
  rule,
  sourceLine,
  stepStartLine,
  table,
  warnLine,
} from './lines.ts';

let out: string[];
let err: string[];
let outSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function stdout(): string {
  return out.join('');
}
function stderr(): string {
  return err.join('');
}

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
  // Plain, colorless, ASCII profile for deterministic, escape-free assertions.
  configureReporter(detectCapabilities({ isTTY: false, env: {} }));
  setReporterSilent(false);
  setReporterLevel('normal');
});

afterEach(() => {
  setReporterSilent(false);
  setReporterLevel('normal');
  outSpy.mockRestore();
  errSpy.mockRestore();
});

describe('line emitters (plain ASCII profile)', () => {
  it('render ASCII markers (info is markerless) with no escape codes', () => {
    doneLine('done');
    infoLine('info');
    questionLine('a question');
    warnLine('warn');
    errorLine('err');
    expect(stdout()).toContain('[ + ] done');
    // info is neutral narration — emitted as plain text, with no marker.
    expect(stdout()).toContain('info');
    expect(stdout()).not.toContain('[ - ]');
    expect(stdout()).toContain('[ ? ] a question');
    expect(stdout()).toContain('[ ! ] warn');
    expect(stderr()).toContain('[ x ] err');
    expect(stdout() + stderr()).not.toContain('\x1b');
  });

  it('stepStartLine keeps the [ - ] marker (a step start pairs with its terminal)', () => {
    stepStartLine('Starting X');
    expect(stdout()).toContain('[ - ] Starting X');
  });

  it('routes errors (and error source lines) to stderr, the rest to stdout', () => {
    doneLine('ok');
    errorLine('boom');
    sourceLine('docker', 'error', 'bad');
    expect(stdout()).toContain('[ + ] ok');
    expect(stdout()).not.toContain('boom');
    expect(stderr()).toContain('[ x ] boom');
    expect(stderr()).toContain('docker  bad');
  });

  it('tags a surfaced subprocess line with its source', () => {
    sourceLine('docker', 'warn', 'orphan containers found');
    expect(stdout()).toContain('[ ! ] docker  orphan containers found');
  });

  it('detailLines emits indented context', () => {
    detailLines(['cause line one', 'cause line two']);
    expect(stdout()).toContain('cause line one');
    expect(stdout()).toContain('cause line two');
  });

  it('rule is an ASCII separator clamped to caps.columns', () => {
    configureReporter(
      detectCapabilities({ isTTY: false, columns: 10, env: {} }),
    );
    rule();
    expect(stdout().trim()).toBe('-'.repeat(10));
    expect(stdout()).not.toContain('\x1b');
  });

  it('table aligns key/value pairs without escapes in plain mode', () => {
    table([
      ['Active', 'blue'],
      ['Version', '1.2.3'],
    ]);
    expect(stdout()).toContain('Active');
    expect(stdout()).toContain('1.2.3');
    expect(stdout()).not.toContain('\x1b');
  });

  it('bannerText is escape-free in a colorless profile', () => {
    expect(bannerText('9.9.9')).toContain('Tale');
    expect(bannerText('9.9.9')).toContain('v9.9.9');
    expect(bannerText('9.9.9')).not.toContain('\x1b');
  });
});

describe('color profile', () => {
  it('emits SGR codes and the unicode marker when capable', () => {
    configureReporter(
      detectCapabilities({
        isTTY: true,
        env: { FORCE_COLOR: '1', LANG: 'en_US.UTF-8' },
      }),
    );
    doneLine('done');
    expect(stdout()).toContain('\x1b[32m'); // green
    expect(stdout()).toContain('[ ✓ ]'); // unicode marker
  });
});

describe('--quiet level', () => {
  beforeEach(() => setReporterLevel('quiet'));

  it('suppresses info / done / rule / non-error source lines', () => {
    infoLine('i');
    doneLine('d');
    rule();
    sourceLine('docker', 'info', 'milestone');
    expect(stdout()).toBe('');
  });

  it('still shows warnings and errors', () => {
    warnLine('w');
    errorLine('e');
    sourceLine('docker', 'error', 'bad');
    expect(stdout()).toContain('[ ! ] w');
    expect(stderr()).toContain('[ x ] e');
    expect(stderr()).toContain('docker  bad');
  });
});

describe('--verbose level', () => {
  it('debugLine shows only under verbose', () => {
    debugLine('trace');
    expect(stdout()).toBe(''); // normal: hidden
    setReporterLevel('verbose');
    debugLine('trace');
    expect(stdout()).toContain('trace');
  });
});

describe('--json (silent) mode', () => {
  beforeEach(() => setReporterSilent(true));

  it('suppresses stdout chrome but still lets errors reach stderr', () => {
    doneLine('d');
    infoLine('i');
    sourceLine('docker', 'info', 'm');
    errorLine('boom');
    expect(stdout()).toBe('');
    expect(stderr()).toContain('[ x ] boom');
  });
});
