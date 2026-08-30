import { describe, expect, it } from 'vitest';

import { chain, createStreamClassifier } from './combinators.ts';
import type { Classifier } from './kinds.ts';
import { classifyBackend } from './sources/backend.ts';
import { classifyBuildKit } from './sources/buildkit.ts';
import { classifyDockerCompose } from './sources/docker-compose.ts';
import { classifyPlatformContainer } from './sources/platform-container.ts';
import { classifyVite } from './sources/vite.ts';

describe('chain', () => {
  it('a later non-noise verdict wins over an earlier noise', () => {
    const docker = chain(classifyBuildKit, classifyDockerCompose);
    // a plain build step is noise on compose but progress on buildkit
    expect(docker('#7 [build 2/9] RUN x').kind).toBe('progress');
  });

  it('a buildkit error beats a compose-noise line on the same stream', () => {
    // `------` is the buildkit error frame; compose has no verdict for it.
    expect(chain(classifyBuildKit, classifyDockerCompose)('------').kind).toBe(
      'error',
    );
  });

  it('all-noise returns noise carrying the raw line', () => {
    const r = chain(classifyBuildKit)('totally unremarkable');
    expect(r.kind).toBe('noise');
    expect(r.raw).toBe('totally unremarkable');
  });

  it('matches the tale-dev 5-classifier wiring on representative lines', () => {
    // Same chain as `tools/cli/src/lib/actions/dev.ts` (compose attach).
    const start = chain(
      classifyBuildKit,
      classifyDockerCompose,
      classifyBackend,
      classifyVite,
      classifyPlatformContainer,
    );
    expect(start('[boot] listening on :3005').kind).toBe('info');
    expect(start('X [ERROR] Transform failed').kind).toBe('error');
    expect(start(' Container tale-db-1  Started').kind).toBe('info');
  });

  it('matches the dev-output 3-classifier wiring', () => {
    const dev = chain(classifyBuildKit, classifyDockerCompose, classifyBackend);
    expect(dev('#5 [stage 1/2] RUN x').kind).toBe('progress');
    expect(dev('2026-08-30T00:00:00Z ERROR job failed: boom').kind).toBe(
      'error',
    );
  });
});

describe('createStreamClassifier (sticky multi-line errors)', () => {
  it('keeps a Vite transform stack surfaced', () => {
    const s = createStreamClassifier(classifyVite);
    const out = [
      'X [ERROR] Transform failed with 1 error:',
      '    at /app/features/chat/x.tsx:12:3',
      '    12 |  const a = ',
      '       |            ^',
    ].map((l) => s(l));
    expect(out.every((c) => c.kind === 'error')).toBe(true);
  });

  it('keeps a backend error + trailing frame surfaced', () => {
    const s = createStreamClassifier(classifyBackend);
    expect(s('2026-08-30T00:00:00Z ERROR job failed: boom').kind).toBe('error');
    expect(s('    at handler (jobs.ts:42)').kind).toBe('error');
  });

  it('keeps a backend error stack surfaced, then resets on a boot milestone', () => {
    const s = createStreamClassifier(classifyBackend);
    expect(s('Uncaught TypeError: x is not a function').kind).toBe('error');
    expect(s('    at runJob (jobs.ts:12:3)').kind).toBe('error');
    // A boot milestone is a clearly-new line — the stream returns to normal.
    expect(s('[boot] listening on :3005').kind).toBe('info');
    expect(s('served GET /api/app/tasks 200 in 3ms').kind).toBe('noise');
  });

  it('treats a blank line inside a trace as a continuation (stays sticky)', () => {
    const s = createStreamClassifier(classifyVite);
    s('X [ERROR] boom');
    expect(s('').kind).toBe('error'); // blank line mid-trace
    expect(s('    at frame').kind).toBe('error');
  });

  it('treats caret-only and code-frame lines as continuations', () => {
    const s = createStreamClassifier(classifyBackend);
    s('Error: nope');
    expect(s('       ^^^^').kind).toBe('error');
    expect(s('  12 │ const x = 1').kind).toBe('error');
  });

  it('resets to normal classification on a clearly-new line', () => {
    const s = createStreamClassifier(classifyVite);
    s('X [ERROR] boom');
    s('    at frame'); // continuation → error
    expect(s('[vite] hmr update /app/y.tsx').kind).toBe('noise'); // new → noise
  });

  it('surfaces two independent error blocks fully (state resets between them)', () => {
    const s = createStreamClassifier(classifyVite);
    expect(s('X [ERROR] first').kind).toBe('error');
    expect(s('    at a').kind).toBe('error');
    expect(s('[vite] hmr update /x').kind).toBe('noise'); // clean line resets
    expect(s('X [ERROR] second').kind).toBe('error');
    expect(s('    at b').kind).toBe('error');
  });

  it('two separate instances do not share state', () => {
    const a = createStreamClassifier(classifyVite);
    const b = createStreamClassifier(classifyVite);
    a('X [ERROR] boom'); // a is now in-error
    // b has seen no error, so an indented line is NOT forced to error
    expect(b('    at frame').kind).toBe('noise');
  });
});

describe('createStreamClassifier — errorBlock / blockEnd', () => {
  it('a blockEnd line closes an armed error block', () => {
    // classifyBackend does not set these flags (they were Convex-era). The
    // stream machine still honors them when a classifier does — left-aligned
    // body stays surfaced until an explicit breaker, not a stack-shaped line.
    const classify: Classifier = (line) => {
      if (line.startsWith('ERROR')) {
        return { kind: 'error', raw: line, text: line, errorBlock: true };
      }
      if (line.startsWith('[ok]')) {
        return { kind: 'noise', raw: line, blockEnd: true };
      }
      return { kind: 'noise', raw: line };
    };
    const stream = createStreamClassifier(classify);
    expect(stream('ERROR job failed').kind).toBe('error');
    expect(stream('left-aligned detail').kind).toBe('error');
    expect(stream('[ok] next event').kind).toBe('noise');
    expect(stream('some unrelated chatter').kind).toBe('noise');
  });
});
