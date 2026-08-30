import { describe, expect, it } from 'vitest';

import { chain, createStreamClassifier } from './combinators.ts';
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

  it('matches the start.ts 5-classifier wiring on representative lines', () => {
    const start = chain(
      classifyBuildKit,
      classifyDockerCompose,
      classifyBackend,
      classifyVite,
      classifyPlatformContainer,
    );
    expect(start('✔ 318 functions ready! (3s)').kind).toBe('info');
    expect(start('X [ERROR] Transform failed').kind).toBe('error');
    expect(start(' Container tale-db-1  Started').kind).toBe('info');
  });

  it('matches the dev-output 3-classifier wiring', () => {
    const dev = chain(classifyBuildKit, classifyDockerCompose, classifyBackend);
    expect(dev('#5 [stage 1/2] RUN x').kind).toBe('progress');
    expect(dev('✖ schema.ts Type error').kind).toBe('error');
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

  it('keeps a Convex push error + trailing frame surfaced', () => {
    const s = createStreamClassifier(classifyBackend);
    expect(s('✖ chat.ts:42 Type error: foo').kind).toBe('error');
    expect(s('    at handler (chat.ts:42)').kind).toBe('error');
  });

  it('keeps a Convex push error body surfaced even when left-aligned (block error)', () => {
    const s = createStreamClassifier(classifyBackend);
    // The header flags a block error; the server message underneath is plain,
    // left-aligned prose that does NOT look like a stack continuation — it must
    // still be surfaced (the regression: this body was being dropped as noise).
    expect(s('✖ Hit an error while pushing:').kind).toBe('error');
    expect(s('InternalServerError: function timed out').kind).toBe('error');
    expect(s('Some additional server detail on its own line').kind).toBe(
      'error',
    );
    // A genuine milestone (a retry's progress / functions-ready) ends the block.
    expect(s('Preparing Convex functions...').kind).toBe('progress');
    expect(s('Watching for file changes...').kind).toBe('noise');
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

describe('createStreamClassifier — blockEnd', () => {
  it('a blockEnd line closes an armed error block (failed push must not paint later runtime logs)', () => {
    const stream = createStreamClassifier(classifyBackend);
    expect(stream('✖ Hit an error while pushing:').kind).toBe('error');
    // Push-error prose stays surfaced…
    expect(stream('TypeScript typecheck failed').kind).toBe('error');
    // …until a runtime function log arrives, which is clearly a new event.
    const success = stream(
      "7/3/2026, 5:44:46 PM [CONVEX A(agents/x:y)] [LOG] 'tool success' {",
    );
    expect(success.kind).toBe('noise');
    // And the stream is back to normal afterwards.
    expect(stream('some unrelated chatter').kind).toBe('noise');
  });
});
