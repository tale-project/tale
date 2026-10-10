import type { ExecResult } from './exec';

/** Optional capture boundary for read-only observations. Every reader and the
 * owned child settle before a safe failure leaves this function. */
export async function boundedOutput(
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>,
  options: { timeout: number; maxOutputBytes: number; stdin?: string },
): Promise<ExecResult> {
  let failure: Error | undefined;
  let bytes = 0;
  const kill = () => {
    try {
      if (process.platform === 'win32') proc.kill('SIGKILL');
      else process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // Exiting naturally can race either failure boundary.
    }
  };
  const refuse = (message: string) => {
    failure ??= new Error(message);
    kill();
  };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > options.maxOutputBytes)
          refuse('Command output exceeded its byte limit.');
        if (!failure) chunks.push(item.value);
      }
      return Buffer.concat(chunks).toString('utf8').trim();
    } catch {
      refuse('Command output could not be read.');
      return '';
    } finally {
      reader.releaseLock();
    }
  };
  const input = async () => {
    if (options.stdin === undefined) return;
    try {
      proc.stdin.write(options.stdin);
      await proc.stdin.end();
    } catch {
      refuse('Command input could not be delivered.');
    }
  };
  const timer = setTimeout(
    () => refuse('Command exceeded its time limit.'),
    options.timeout * 1000,
  );
  const exited = proc.exited.catch(() => {
    refuse('Command exit could not be observed.');
    return -1;
  });
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      read(proc.stdout),
      read(proc.stderr),
      exited,
      input(),
    ]);
    if (failure) throw failure;
    return { success: exitCode === 0, stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
    // Reap the process group even when a child exits leaving a descendant.
    kill();
    await exited;
  }
}
