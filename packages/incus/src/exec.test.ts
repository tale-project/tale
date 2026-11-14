// Exec modes 1 and 2: how the command line is built (stdin as a pushed
// file, the image's `timeout`), what Incus is asked, and what is left
// behind (nothing: the stdin file is gone, the record-output files deleted).

import { describe, expect, spyOn, test } from 'bun:test';

import {
  EXEC_PAYLOAD_PREFIX,
  execCommandLine,
  execForCode,
  execWithOutput,
  MAX_EXEC_PAYLOAD_BYTES,
  unwrapExecCommand,
} from './exec.ts';
import { FakeIncus } from './fake.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

function running(): FakeIncus {
  const fake = new FakeIncus({ project: 'stack' });
  fake.seedInstance(
    'db',
    { 'environment.TALE_TOKEN': 's3cret' },
    {
      ephemeral: false,
    },
  );
  return fake;
}

describe('the command line', () => {
  test('stdin is a file the shell redirects in and removes, never argv', () => {
    const line = execCommandLine(['psql', '-q'], {
      payloadPath: '/dev/shm/tale-exec-x',
    });
    expect(line.slice(0, 2)).toEqual(['/bin/sh', '-c']);
    expect(line[2]).toContain('exec 0<"$1"');
    expect(line[2]).toContain('rm -f -- "$1"');
    expect(line.slice(-3)).toEqual(['/dev/shm/tale-exec-x', 'psql', '-q']);
  });

  test('the image’s timeout wraps everything, and reads back', () => {
    const line = execCommandLine(['pg_isready'], {
      timeoutCommand: '/usr/bin/timeout',
      timeoutSeconds: 5,
      payloadPath: '/dev/shm/p',
    });
    expect(line.slice(0, 2)).toEqual(['/usr/bin/timeout', '5']);
    expect(unwrapExecCommand(line)).toEqual({
      argv: ['pg_isready'],
      timeoutSeconds: 5,
      payloadPath: '/dev/shm/p',
    });
  });

  test('a plain command reads back as itself', () => {
    expect(unwrapExecCommand(['timeout', 'x'])).toEqual({
      argv: ['timeout', 'x'],
    });
  });

  test('no command and no timeout are refused', () => {
    expect(() => execCommandLine([])).toThrow('needs a command');
    expect(() =>
      execCommandLine(['x'], { timeoutCommand: 'timeout', timeoutSeconds: 0 }),
    ).toThrow('Not an exec timeout');
  });
});

describe('mode 1: the exit code', () => {
  test('runs as the given user, without record-output or websockets', async () => {
    const fake = running();
    fake.exec = (call) => (call.command[0] === 'false' ? 1 : 0);
    const client = fake.client();
    expect(
      await execForCode(client, 'db', ['false'], {
        timeoutSeconds: 5,
        user: 70,
        group: 70,
        cwd: '/var/lib/postgresql',
        environment: { PGUSER: 'tale' },
      }),
    ).toBe(1);
    const [request] = fake.seen('POST /1.0/instances/db/exec');
    expect(request?.query.project).toBe('stack');
    expect(request?.body).toEqual({
      command: ['false'],
      environment: { PGUSER: 'tale' },
      'wait-for-websocket': false,
      'record-output': false,
      interactive: false,
      user: 70,
      group: 70,
      cwd: '/var/lib/postgresql',
    });
    expect(fake.execs[0]?.environment).toEqual({
      TALE_TOKEN: 's3cret',
      PGUSER: 'tale',
    });
  });

  test('stdin reaches the command through a 0600 file owned by the exec user, which is gone after', async () => {
    const fake = running();
    let seen = '';
    fake.exec = async (_call, io) => {
      seen = new TextDecoder().decode(await io.stdin());
      return 0;
    };
    const client = fake.client();
    await execForCode(client, 'db', ['psql'], {
      timeoutSeconds: 5,
      user: 70,
      group: 71,
      stdin: 'SELECT 1;',
    });
    expect(seen).toBe('SELECT 1;');
    const [push] = fake.seen('POST /1.0/instances/db/files');
    expect(push?.query.path).toStartWith(`/dev/shm/${EXEC_PAYLOAD_PREFIX}`);
    expect(push?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
      'x-incus-mode': '0600',
      'x-incus-uid': '70',
      'x-incus-gid': '71',
    });
    const [exec] = fake.seen('POST /1.0/instances/db/exec');
    expect(JSON.stringify(exec?.body)).not.toContain('SELECT 1;');
    expect(fake.instances.get('db')?.files.size).toBe(0);
  });

  test('a stdin over 1 MiB is refused before anything is pushed', async () => {
    const fake = running();
    const error = await rejection(
      execForCode(fake.client(), 'db', ['cat'], {
        timeoutSeconds: 5,
        stdin: new Uint8Array(MAX_EXEC_PAYLOAD_BYTES + 1),
      }),
    );
    expect(error.message).toContain('websocket session');
    expect(fake.requests).toEqual([]);
  });

  test('a stdin file whose exec never started is removed', async () => {
    const fake = running();
    fake.fail({
      match: 'POST /1.0/instances/db/exec',
      status: 400,
      message: 'Instance is not running',
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await rejection(
        execForCode(fake.client(), 'db', ['psql'], {
          timeoutSeconds: 5,
          stdin: 'x',
        }),
      );
    } finally {
      warn.mockRestore();
    }
    expect(fake.seen('DELETE /1.0/instances/db/files')).toHaveLength(1);
    expect(fake.instances.get('db')?.files.size).toBe(0);
  });

  test('the image’s timeout bounds the command inside the instance', async () => {
    const fake = running();
    const client = fake.client();
    await execForCode(client, 'db', ['pg_dump'], {
      timeoutSeconds: 30,
      timeoutCommand: '/usr/bin/timeout',
    });
    expect(fake.execs[0]?.timeoutSeconds).toBe(30);
    expect(fake.execs[0]?.command).toEqual(['pg_dump']);
  });
});

describe('mode 2: the code and bounded output', () => {
  test('returns both streams and deletes the record-output files', async () => {
    const fake = running();
    fake.exec = (_call, io) => {
      io.write(1, 'out\n');
      io.write(2, 'err\n');
      return 3;
    };
    const result = await execWithOutput(fake.client(), 'db', ['x'], {
      timeoutSeconds: 5,
      maxOutputBytes: 1024,
    });
    expect(result.exitCode).toBe(3);
    expect(new TextDecoder().decode(result.stdout)).toBe('out\n');
    expect(new TextDecoder().decode(result.stderr)).toBe('err\n');
    expect(fake.seen('POST /1.0/instances/db/exec')[0]?.body).toMatchObject({
      'record-output': true,
    });
    expect(
      fake.seen('DELETE /1.0/instances/db/logs/exec-output/*'),
    ).toHaveLength(2);
    expect(
      [...(fake.instances.get('db')?.logs.keys() ?? [])].filter((key) =>
        key.startsWith('exec-output/'),
      ),
    ).toEqual([]);
  });

  test('output over the cap throws, and the files are deleted all the same', async () => {
    const fake = running();
    fake.exec = (_call, io) => {
      io.write(1, 'a'.repeat(600));
      io.write(2, 'b'.repeat(600));
      return 0;
    };
    const error = await rejection(
      execWithOutput(fake.client(), 'db', ['x'], {
        timeoutSeconds: 5,
        maxOutputBytes: 1000,
      }),
    );
    expect(error.message).toBe('Command output exceeded its byte limit.');
    expect(
      fake.seen('DELETE /1.0/instances/db/logs/exec-output/*'),
    ).toHaveLength(2);
  });

  test('an output path outside the exec-output logs is refused, not read', async () => {
    const fake = running();
    const client = fake.client();
    const original = client.waitOperation.bind(client);
    client.waitOperation = async (...args) => {
      const done = await original(...args);
      return {
        ...done,
        metadata: { return: 0, output: { '1': '/1.0/instances/other/logs/x' } },
      };
    };
    const error = await rejection(
      execWithOutput(client, 'db', ['x'], {
        timeoutSeconds: 5,
        maxOutputBytes: 10,
      }),
    );
    expect(error.message).toContain('outside');
    expect(fake.seen('GET /1.0/instances/other/*/*')).toEqual([]);
  });
});

describe('cancellation', () => {
  test('a record-output exec cannot be cancelled: Incus’s words come back', async () => {
    const fake = running();
    const client = fake.client();
    const error = await rejection(client.cancelOperation('op-1'));
    expect(error.message).toContain('Operation not found');
    await execForCode(client, 'db', ['true'], { timeoutSeconds: 5 });
    const refused = await rejection(client.cancelOperation('op-1'));
    expect(refused.message).toContain("can't be cancelled");
  });
});
