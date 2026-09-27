// @vitest-environment node

/**
 * `classifyBackend` reads prose, and the backend's warnings are not written in
 * prose it can recognise — none of its ~430 `console.warn` calls spell `WARN`.
 * Every one of them was classified as noise and dropped, so `bun dev` showed a
 * clean loop while the backend was reporting a stale toolchain, a burned
 * browser session, or a re-queued job into the void.
 *
 * The stream carries the severity the prose does not: for a plain Node server,
 * `console.warn`/`console.error` go to stderr. `stderrIsSignal` says so.
 */

import { PassThrough } from 'node:stream';

import { classifyBackend } from '@tale/shared/classify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sourceLine = vi.fn();

vi.mock('@tale/shared/tux', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/shared/tux')>();
  return {
    ...actual,
    sourceLine: (...args: unknown[]) => sourceLine(...args),
  };
});

const { pipeChild } = await import('./dev-output.ts');

/** A child whose streams we can write into, shaped like `ChildProcess`. */
function fakeChild(): {
  child: Parameters<typeof pipeChild>[0];
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return { child: { stdout, stderr }, stdout, stderr };
}

/** Write a line and let the stream's data event land. */
async function emit(stream: PassThrough, line: string): Promise<void> {
  stream.write(`${line}\n`);
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('pipeChild with stderrIsSignal', () => {
  it('surfaces an unrecognised stderr line as a warning', async () => {
    const { child, stderr } = fakeChild();
    pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'errors',
      stderrIsSignal: true,
    });

    // Verbatim shape of a real backend `console.warn`: no ERROR, no WARN, so
    // the classifier calls it noise.
    const warning =
      '[ytdlp] yt-dlp 2026.03.17 on PATH is older than the 2026.07.04 this image pins.';
    expect(classifyBackend(warning).kind).toBe('noise');

    await emit(stderr, warning);

    expect(sourceLine).toHaveBeenCalledWith('backend', 'warn', warning);
  });

  it('leaves stdout alone, however chatty', async () => {
    const { child, stdout } = fakeChild();
    pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'errors',
      stderrIsSignal: true,
    });

    await emit(stdout, 'served GET /api/app/tasks 200 in 3ms');

    expect(sourceLine).not.toHaveBeenCalled();
  });

  it('does not promote blank stderr lines', async () => {
    const { child, stderr } = fakeChild();
    pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'errors',
      stderrIsSignal: true,
    });

    await emit(stderr, '   ');

    expect(sourceLine).not.toHaveBeenCalled();
  });

  it('keeps an error an error rather than demoting it to warn', async () => {
    const { child, stderr } = fakeChild();
    pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'errors',
      stderrIsSignal: true,
    });

    await emit(stderr, 'Uncaught TypeError: x is not a function');

    expect(sourceLine).toHaveBeenCalledWith(
      'backend',
      'error',
      'Uncaught TypeError: x is not a function',
    );
  });

  it('stays silent on stderr when the caller has not vouched for it', async () => {
    // Docker and BuildKit put their whole progress feed on stderr; the flag is
    // opt-in precisely so they keep collapsing.
    const { child, stderr } = fakeChild();
    pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'errors',
    });

    await emit(stderr, '[ytdlp] something the classifier cannot name');

    expect(sourceLine).not.toHaveBeenCalled();
  });

  it('records a promoted line in the failure-dump signal too', async () => {
    const { child, stderr } = fakeChild();
    const handle = pipeChild(child, {
      label: 'backend',
      classifier: classifyBackend,
      mode: 'silent',
      stderrIsSignal: true,
    });

    await emit(stderr, '[video_link] browser-session claim failed');

    // `silent` prints nothing live, but a later failure dump must still have it.
    expect(sourceLine).not.toHaveBeenCalled();
    expect(handle.signal()).toEqual([
      '[video_link] browser-session claim failed',
    ]);
  });
});

/**
 * A step's failure dump is read once the child has exited, but `exit` can
 * arrive before the pipes are drained, and the lines still in flight are the
 * ones that name the failure. `done` is what the dump waits for.
 */
describe('pipeChild done', () => {
  it('waits for the last line a child writes as it exits', async () => {
    const { child, stdout, stderr } = fakeChild();
    const handle = pipeChild(child, { label: 'wait-on' });
    let drained = false;
    void handle.done.then(() => {
      drained = true;
    });

    await emit(stderr, 'Error: connect ECONNREFUSED 127.0.0.1:3005');
    // The child's last words carry no newline, so they land only when its
    // stream ends; a dump read at this point, on `exit`, would miss them.
    stderr.end('Error: Timed out waiting for: tcp:127.0.0.1:3005');
    expect(handle.signal()).toEqual([
      'Error: connect ECONNREFUSED 127.0.0.1:3005',
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);

    stdout.end();
    await handle.done;

    const lines = [
      'Error: connect ECONNREFUSED 127.0.0.1:3005',
      'Error: Timed out waiting for: tcp:127.0.0.1:3005',
    ];
    expect(handle.signal()).toEqual(lines);
    expect(handle.tail(15)).toEqual(lines);
  });

  it('rejects when a read fails, keeping every line read before it', async () => {
    const { child, stdout, stderr } = fakeChild();
    const handle = pipeChild(child, { label: 'wait-on' });

    await emit(stderr, 'Error: connect ECONNREFUSED 127.0.0.1:3005');
    stderr.destroy(new Error('read failed'));
    stdout.end();

    await expect(handle.done).rejects.toThrow('read failed');
    expect(handle.signal()).toEqual([
      'Error: connect ECONNREFUSED 127.0.0.1:3005',
    ]);
  });
});
