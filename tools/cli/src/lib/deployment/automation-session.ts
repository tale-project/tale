import { randomUUID } from 'node:crypto';

import { preconditionError } from '../../utils/fail';
import { migrationSessionCommand } from './acceptance-migrations';
import { runtimeProcessEnvironment } from './runtime-command';
import { requireRuntime, type RuntimeSqlSession } from './runtime-model';

const sessionFailure = () =>
  preconditionError(
    'The automation cutover lock session was lost or timed out. No new runtime may start; retry the same managed deployment to reconcile its stopped writers.',
  );

/** Private bounded psql session. It never exposes Docker/SQL error payloads.
 * PostgreSQL's idle timeout also retires the transaction after a CLI crash. */
export async function automationSession(
  containerId: string,
): Promise<RuntimeSqlSession> {
  requireRuntime(
    /^[a-f0-9]{64}$/.test(containerId),
    'Invalid cutover database identity.',
  );
  const proc = Bun.spawn(
    [
      'docker',
      'exec',
      '-i',
      containerId,
      'sh',
      '-c',
      migrationSessionCommand('db'),
    ],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: runtimeProcessEnvironment(),
    },
  );
  let alive = true;
  let closing = false;
  let bytes = 0;
  let pending:
    | {
        token: string;
        lines: string[];
        resolve: (value: string) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const fail = () => {
    alive = false;
    pending?.reject(sessionFailure());
    pending = undefined;
    proc.kill();
  };
  const deadline = setTimeout(fail, 90_000);
  const consume = async (
    stream: ReadableStream<Uint8Array>,
    output: boolean,
  ) => {
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for await (const chunk of stream) {
        bytes += chunk.byteLength;
        if (bytes > 1_048_576) {
          fail();
          return;
        }
        if (!output) continue;
        buffered += decoder.decode(chunk, { stream: true });
        let newline: number;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline).replace(/\r$/, '');
          buffered = buffered.slice(newline + 1);
          if (!pending) {
            if (!closing) fail();
            continue;
          }
          if (line === pending.token) {
            const result = pending;
            pending = undefined;
            result.resolve(result.lines.join('\n'));
          } else pending.lines.push(line);
        }
      }
      if (!closing) fail();
    } catch {
      fail();
    }
  };
  const readers = [consume(proc.stdout, true), consume(proc.stderr, false)];
  void proc.exited.then(() => {
    if (!closing) fail();
    return undefined;
  });
  return {
    healthy: () => alive && !closing && proc.exitCode === null,
    async query(sql) {
      if (!alive || closing || pending || proc.exitCode !== null)
        throw sessionFailure();
      const token = `TALE_${randomUUID().replaceAll('-', '')}`;
      const timer = setTimeout(fail, 10_000);
      try {
        return await new Promise<string>((resolve, reject) => {
          pending = { token, lines: [], resolve, reject };
          try {
            proc.stdin.write(`${sql}\n\\echo ${token}\n`);
            void Promise.resolve(proc.stdin.flush()).catch(fail);
          } catch {
            fail();
          }
        });
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      clearTimeout(deadline);
      closing = true;
      alive = false;
      pending?.reject(sessionFailure());
      pending = undefined;
      const timer = setTimeout(() => proc.kill(), 5_000);
      try {
        try {
          proc.stdin.write('ROLLBACK;\n\\q\n');
          await proc.stdin.end();
        } catch {
          /* The lost connection itself rolls back; no startup follows it. */
        }
        await proc.exited;
        await Promise.all(readers);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
