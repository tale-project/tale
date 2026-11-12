import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { MAX_EXEC_PAYLOAD_BYTES } from '@tale/incus/exec';

import { readJournal, recordPayload } from '../apply/journal';
import {
  chooseExecMode,
  execInInstance,
  execSessionInInstance,
  reapPayloads,
} from './exec';
import {
  seedStackInstance,
  STACK,
  verbsFixture,
  WITHOUT_TIMEOUT,
  type VerbsFixture,
} from './verbs-fixture';

let fixture: VerbsFixture;

beforeEach(() => {
  fixture = verbsFixture();
});
afterEach(() => {
  fixture.remove();
});

describe('the exec mode', () => {
  const base = {
    timeoutCommand: '/usr/bin/timeout',
    stdinBytes: null,
    service: 'backend-api',
    output: 'record' as const,
  };

  test('runs under the image timeout in mode 1 or 2, else over the websocket', () => {
    expect(chooseExecMode(base)).toEqual({
      mode: 'record-output',
      stdin: null,
    });
    expect(chooseExecMode({ ...base, output: 'discard' })).toEqual({
      mode: 'code',
      stdin: null,
    });
    expect(chooseExecMode({ ...base, timeoutCommand: null })).toEqual({
      mode: 'websocket',
      stdin: null,
    });
  });

  test('a stdin goes as a file up to 1 MiB, over the websocket past it or for db', () => {
    expect(chooseExecMode({ ...base, stdinBytes: 10 })).toEqual({
      mode: 'record-output',
      stdin: 'file',
    });
    expect(
      chooseExecMode({ ...base, stdinBytes: MAX_EXEC_PAYLOAD_BYTES + 1 }),
    ).toEqual({ mode: 'websocket', stdin: 'websocket' });
    expect(chooseExecMode({ ...base, stdinBytes: 10, service: 'db' })).toEqual({
      mode: 'websocket',
      stdin: 'websocket',
    });
    expect(chooseExecMode({ ...base, service: 'db' }).mode).toBe(
      'record-output',
    );
  });
});

describe('exec in an instance', () => {
  test('mode 2 records the output under the image timeout and deletes it', async () => {
    seedStackInstance(fixture.fake, 'api', { service: 'backend-api' });
    fixture.fake.exec = (call, io) => {
      io.write(1, `ran ${call.command.join(' ')}\n`);
      io.write(2, 'note\n');
      return 3;
    };
    const result = await execInInstance(fixture.context, 'api', ['echo', 'x'], {
      timeoutS: 20,
    });
    expect(result).toEqual({
      success: false,
      stdout: 'ran echo x',
      stderr: 'note',
      exitCode: 3,
    });
    const call = fixture.fake.execs.at(-1);
    expect(call?.mode).toBe('record-output');
    expect(call?.timeoutSeconds).toBe(20);
    expect(call?.argv.slice(0, 2)).toEqual(['/usr/bin/timeout', '20']);
    expect(
      [...(fixture.fake.instances.get('api')?.logs.keys() ?? [])].filter(
        (key) => key.startsWith('exec-output/'),
      ),
    ).toEqual([]);
  });

  test('stdin is a journaled 0600 file of the exec user, gone after, never argv', async () => {
    seedStackInstance(fixture.fake, 'api', {
      service: 'backend-api',
      config: { 'oci.uid': '1001', 'oci.gid': '1002' },
    });
    const payload = '{"newPassword":"payload-on-stdin-4b2e"}';
    const seen: { stdin: string; user: number; group: number }[] = [];
    let journaled = 0;
    fixture.fake.exec = async (call, io) => {
      seen.push({
        stdin: new TextDecoder().decode(await io.stdin()),
        user: call.user,
        group: call.group,
      });
      journaled = (await readJournal(fixture.stateRoot))?.payloads.length ?? 0;
      return 0;
    };
    const writes = () =>
      fixture.fake
        .seen('POST /1.0/instances/api/files')
        .map((request) => request.query.path ?? '');
    const result = await execInInstance(fixture.context, 'api', ['cat'], {
      stdin: payload,
    });
    expect(result.success).toBe(true);
    expect(seen).toEqual([{ stdin: payload, user: 1001, group: 1002 }]);
    expect(journaled).toBe(1);
    const [path] = writes();
    expect(path).toMatch(/^\/dev\/shm\/tale-exec-[0-9a-f]{32}$/);
    const request = fixture.fake.seen('POST /1.0/instances/api/files')[0];
    const written = {
      uid: Number(request?.headers['x-incus-uid']),
      gid: Number(request?.headers['x-incus-gid']),
      mode: request?.headers['x-incus-mode'] ?? '',
    };
    expect(written).toEqual({ uid: 1001, gid: 1002, mode: '0600' });
    expect(fixture.fake.instances.get('api')?.files.has(path ?? '')).toBe(
      false,
    );
    expect((await readJournal(fixture.stateRoot))?.payloads).toEqual([]);
    expect(JSON.stringify(fixture.fake.execs.map((c) => c.argv))).not.toContain(
      'payload-on-stdin',
    );
  });

  test('an image without timeout, a large stdin and any stdin for db go over the websocket', async () => {
    seedStackInstance(fixture.fake, 'worker', { image: WITHOUT_TIMEOUT });
    seedStackInstance(fixture.fake, 'api', { service: 'backend-api' });
    seedStackInstance(fixture.fake, 'db', { service: 'db' });
    fixture.fake.exec = async (_call, io) => {
      const stdin = await io.stdin();
      io.write(1, `${stdin.byteLength}`);
      return 0;
    };
    const big = 'x'.repeat(MAX_EXEC_PAYLOAD_BYTES + 1);
    expect(
      (await execInInstance(fixture.context, 'worker', ['true'])).stdout,
    ).toBe('0');
    expect(
      (await execInInstance(fixture.context, 'api', ['cat'], { stdin: big }))
        .stdout,
    ).toBe(String(big.length));
    expect(
      (await execInInstance(fixture.context, 'db', ['psql'], { stdin: 'x' }))
        .stdout,
    ).toBe('1');
    expect(fixture.fake.execs.map((call) => call.mode)).toEqual([
      'websocket',
      'websocket',
      'websocket',
    ]);
    // Nothing was written into any instance.
    expect(fixture.fake.seen('POST /1.0/instances/*/files')).toEqual([]);
  });

  test('mode 1 reads the exit code alone', async () => {
    seedStackInstance(fixture.fake, 'api');
    fixture.fake.exec = () => 1;
    expect(
      await execInInstance(fixture.context, 'api', ['false'], {
        output: 'discard',
      }),
    ).toEqual({ success: false, stdout: '', stderr: '', exitCode: 1 });
    expect(fixture.fake.execs.at(-1)?.mode).toBe('code');
  });

  test('output past the byte cap fails, over either path', async () => {
    seedStackInstance(fixture.fake, 'api');
    seedStackInstance(fixture.fake, 'worker', { image: WITHOUT_TIMEOUT });
    fixture.fake.exec = (_call, io) => {
      io.write(1, 'y'.repeat(100));
      return 0;
    };
    for (const name of ['api', 'worker'])
      await expect(
        execInInstance(fixture.context, name, ['yes'], { maxOutputBytes: 10 }),
      ).rejects.toThrow('exceeded its byte limit');
  });

  test('a websocket exec past its deadline is ended', async () => {
    seedStackInstance(fixture.fake, 'worker', { image: WITHOUT_TIMEOUT });
    fixture.fake.exec = (_call, io) =>
      new Promise<number>((resolve) => {
        io.killed.addEventListener('abort', () => resolve(137));
      });
    await expect(
      execInInstance(fixture.context, 'worker', ['sleep', '60'], {
        timeoutS: 1,
      }),
    ).rejects.toThrow('exceeded its time limit');
  });

  test('the image timeout ending a command at the deadline fails it; an earlier 124 or 143 is the command’s own', async () => {
    seedStackInstance(fixture.fake, 'api');
    fixture.fake.exec = () => 143;
    expect(
      (await execInInstance(fixture.context, 'api', ['false'])).exitCode,
    ).toBe(143);
    fixture.fake.exec = async () => {
      await Bun.sleep(1_100);
      return 143;
    };
    await expect(
      execInInstance(fixture.context, 'api', ['sleep', '9'], { timeoutS: 1 }),
    ).rejects.toThrow('Command exceeded its time limit.');
  });

  test('a stopped or missing instance fails without an exec', async () => {
    seedStackInstance(fixture.fake, 'api', { status: 'Stopped' });
    expect(await execInInstance(fixture.context, 'api', ['true'])).toEqual({
      success: false,
      stdout: '',
      stderr: 'api is not running (Stopped).',
      exitCode: 1,
    });
    expect(
      (await execInInstance(fixture.context, 'gone', ['true'])).stderr,
    ).toBe('There is no instance gone.');
    expect(fixture.fake.execs).toEqual([]);
  });
});

describe('stdin files a crash left', () => {
  test('are reaped before the next exec in their instance, and forgotten', async () => {
    const db = seedStackInstance(fixture.fake, 'db', { service: 'db' });
    const leaked = '/dev/shm/tale-exec-leaked';
    db.files.set(leaked, { content: 'secret', mode: '0600' });
    await recordPayload(fixture.stateRoot, STACK, {
      instance: 'db',
      path: leaked,
    });
    await recordPayload(fixture.stateRoot, STACK, {
      instance: 'gone',
      path: '/dev/shm/tale-exec-other',
    });
    await execInInstance(fixture.context, 'db', ['true']);
    expect(db.files.has(leaked)).toBe(false);
    expect((await readJournal(fixture.stateRoot))?.payloads).toEqual([
      { instance: 'gone', path: '/dev/shm/tale-exec-other' },
    ]);
    // An instance that is gone has nothing left to reap.
    expect(await reapPayloads(fixture.context)).toEqual([]);
    expect((await readJournal(fixture.stateRoot))?.payloads).toEqual([]);
  });

  test('parallel execs journal every stdin file: no update writes over another', async () => {
    const paths = Array.from(
      { length: 12 },
      (_, index) => `/dev/shm/tale-exec-${index}`,
    );
    await Promise.all(
      paths.map((path) =>
        recordPayload(fixture.stateRoot, STACK, { instance: 'api', path }),
      ),
    );
    expect(
      (await readJournal(fixture.stateRoot))?.payloads
        .map((p) => p.path)
        .sort(),
    ).toEqual([...paths].sort());
  });

  test('a reap beside a running exec spares the stdin file that exec still reads', async () => {
    seedStackInstance(fixture.fake, 'api', { service: 'backend-api' });
    let stdin = '';
    fixture.fake.exec = async (_call, io) => {
      stdin = new TextDecoder().decode(await io.stdin());
      return 0;
    };
    const release = fixture.fake.hold('POST /1.0/instances/api/exec');
    const running = execInInstance(fixture.context, 'api', ['cat'], {
      stdin: 'body-of-a-control-call',
    });
    while (fixture.fake.seen('POST /1.0/instances/api/exec').length === 0)
      await Bun.sleep(1);
    // What a parallel exec in the same instance (a health probe) runs first.
    expect(await reapPayloads(fixture.context, 'api')).toEqual([]);
    release();
    expect((await running).success).toBe(true);
    expect(stdin).toBe('body-of-a-control-call');
    expect((await readJournal(fixture.stateRoot))?.payloads).toEqual([]);
  });
});

describe('a held exec session', () => {
  test('streams stdin and stdout over the websocket and ends with its code', async () => {
    seedStackInstance(fixture.fake, 'db', { service: 'db' });
    fixture.fake.exec = async (_call, io) => {
      for await (const chunk of io.stdinChunks()) {
        const text = new TextDecoder().decode(chunk);
        io.write(1, text.toUpperCase());
      }
      return 5;
    };
    const session = await execSessionInInstance(fixture.context, 'db', [
      'psql',
    ]);
    session.stdin.write('select 1;\n');
    session.stdin.flush();
    const reader = session.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('SELECT 1;\n');
    session.stdin.end();
    expect(await session.exited).toBe(5);
    expect(session.exitCode).toBe(5);
    expect((await reader.read()).done).toBe(true);
  });

  test('kill ends the command', async () => {
    seedStackInstance(fixture.fake, 'db', { service: 'db' });
    fixture.fake.exec = (_call, io) =>
      new Promise<number>((resolve) => {
        io.killed.addEventListener('abort', () => resolve(137));
      });
    const session = await execSessionInInstance(fixture.context, 'db', [
      'psql',
    ]);
    session.kill();
    expect(await session.exited).toBe(137);
  });

  test('a stopped instance has no session', async () => {
    seedStackInstance(fixture.fake, 'db', { status: 'Stopped' });
    await expect(
      execSessionInInstance(fixture.context, 'db', ['psql']),
    ).rejects.toThrow('db is not running');
  });
});
