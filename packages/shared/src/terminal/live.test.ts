import { describe, expect, it } from 'vitest';

import { detectCapabilities } from './capabilities.ts';
import { LiveRegion } from './live.ts';

function harness(interactive: boolean, columns = 80) {
  const chunks: string[] = [];
  const region = new LiveRegion({
    write: (c) => chunks.push(c),
    capabilities: detectCapabilities({
      isTTY: interactive,
      platform: 'linux',
      columns,
      env: interactive ? {} : { CI: '1' },
    }),
    registerExit: () => {},
    columns: () => columns,
  });
  return { region, output: () => chunks.join('') };
}

describe('LiveRegion (interactive)', () => {
  it('hides the cursor on mount and restores it on dispose', () => {
    const { region, output } = harness(true);
    expect(output()).toContain('\x1b[?25l');
    region.dispose();
    expect(output()).toContain('\x1b[?25h');
  });

  it('NEVER emits a full-screen clear or absolute cursor move', () => {
    const { region, output } = harness(true, 40);
    region.render(['line one', 'line two', 'line three']);
    region.print('a permanent line');
    region.render(['only one now']);
    region.clear();
    region.dispose();
    const all = output();
    expect(all).not.toContain('\x1b[2J');
    expect(all).not.toMatch(/\x1b\[\d+;\d+H/); // absolute positioning
  });

  it('only uses the safe escape set (up / clear-line / cursor show-hide / SGR)', () => {
    const { region, output } = harness(true);
    region.render(['x', 'y']);
    region.render(['x', 'y', 'z']);
    region.dispose();
    // Every CSI in the output must be one of: up(A), clearLine(2K), ?25l/h.
    const escapes = output().match(/\x1b\[[0-?]*[ -/]*[@-~]/g) ?? [];
    for (const seq of escapes) {
      expect(seq).toMatch(/^\x1b\[(?:\d*A|2K|\?25[lh])$/);
    }
  });

  it('truncates region lines below the column width so they cannot wrap', () => {
    const { region, output } = harness(true, 10);
    region.render(['x'.repeat(50)]);
    region.dispose();
    // The longest printed run of x's must be < columns (10), i.e. <= 9.
    const longestRun = Math.max(
      0,
      ...(output().match(/x+/g) ?? ['']).map((s) => s.length),
    );
    expect(longestRun).toBeLessThanOrEqual(9);
  });

  it('graduates a permanent line above the live block', () => {
    const { region, output } = harness(true);
    region.render(['live']);
    region.print('history');
    region.dispose();
    expect(output()).toContain('history\n');
  });
});

describe('LiveRegion (plain / non-interactive)', () => {
  it('emits zero escape codes and only append-only lines', () => {
    const { region, output } = harness(false);
    region.render(['this should be a no-op in plain mode']);
    region.print('plain line');
    region.clear();
    region.dispose();
    const all = output();
    expect(all).not.toContain('\x1b');
    expect(all).toBe('plain line\n');
  });
});
