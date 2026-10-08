// Executed only by the explicit native fixture, inside its owned container.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  DockerAdmissionOwner,
  HOST_ADMISSION_OWNER_NAME,
} from '../../src/host-admission-owner.ts';
import { runDocker } from '../../src/spawn-util.ts';

const nonce = process.env.TEST_ADMISSION_NONCE;
assert.match(nonce ?? '', /^[a-f0-9]{32}$/);
const recordName = `tale-admission-test-record-${nonce}`;
const root = new URL('../../', import.meta.url);
const role = process.argv[2];
const until = performance.now() + 50_000;
const barrier = (name: string) => `/tmp/${nonce}-${name}`;

async function waitFor(predicate: () => boolean): Promise<void> {
  while (!predicate()) {
    assert.ok(performance.now() < until, 'native fixture barrier expired');
    await Bun.sleep(10);
  }
}

if (role === 'a' || role === 'b' || role === 'restart') {
  const owner = new DockerAdmissionOwner({
    docker: (args, timeoutMs) => {
      const scoped = args.map((arg) =>
        arg === HOST_ADMISSION_OWNER_NAME ? recordName : arg,
      );
      if (scoped[0] === 'create')
        scoped.splice(-1, 0, '--label', `tale.test.host-admission=${nonce}`);
      return runDocker(scoped, {
        timeoutMs,
        priority: true,
        stdoutMaxBytes: 16_384,
        stderrMaxBytes: 1024,
      });
    },
  });
  if (role !== 'restart') {
    writeFileSync(barrier(`${role}.ready`), 'ready');
    await waitFor(() => existsSync(barrier('go')));
  }
  try {
    const identity = await owner.acquire();
    await owner.assertCurrent();
    console.log(JSON.stringify({ acquired: true, identity, pid: process.pid }));
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /held by another or unknown incarnation/);
    console.log(JSON.stringify({ acquired: false, pid: process.pid }));
  }
} else {
  assert.equal(role, 'coordinate');
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const start = (childRole: string) => {
    const child = Bun.spawn(
      [process.execPath, import.meta.filename, childRole],
      {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    children.push(child);
    // Attach handlers immediately so early child failure cannot escape cleanup.
    return Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]).then(([code, stdout, stderr]) => {
      assert.equal(code, 0, `native child failed: ${stderr.slice(0, 1024)}`);
      assert.equal(stderr, '');
      const value: unknown = JSON.parse(stdout);
      assert.ok(
        value !== null && typeof value === 'object' && !Array.isArray(value),
      );
      assert.ok('acquired' in value && typeof value.acquired === 'boolean');
      assert.ok(
        'pid' in value &&
          typeof value.pid === 'number' &&
          Number.isSafeInteger(value.pid),
      );
      return { ...value, acquired: value.acquired, pid: value.pid };
    });
  };
  try {
    const peers = [start('a'), start('b')];
    // Settle immediately even if readiness itself fails.
    const settled = Promise.allSettled(peers);
    await waitFor(() =>
      ['a', 'b'].every((name) => existsSync(barrier(`${name}.ready`))),
    );
    writeFileSync(barrier('go'), 'go');
    const outcomes = await settled;
    const values = outcomes.map((result) => {
      if (result.status !== 'fulfilled') throw result.reason;
      return result.value;
    });
    assert.equal(new Set(values.map((value) => value.pid)).size, 2);
    const winners = values.filter((value) => value.acquired);
    assert.equal(winners.length, 1);
    assert.equal((await start('restart')).acquired, false);
    const dockerPath = Bun.which('docker');
    assert.ok(dockerPath);
    const dockerCliSha256 = createHash('sha256')
      .update(readFileSync(dockerPath))
      .digest('hex');
    const source = Object.fromEntries(
      [
        'src/host-admission-owner.ts',
        'src/spawn-util.ts',
        'src/operation-budget.ts',
        'tests/native/host-admission-client.ts',
      ].map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(new URL(path, root)))
          .digest('hex'),
      ]),
    );
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        bun: Bun.version,
        dockerCliSha256,
        source,
        peers: values,
        hotRestartRefused: true,
      }),
    );
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await Promise.all(children.map((child) => child.exited));
  }
}
