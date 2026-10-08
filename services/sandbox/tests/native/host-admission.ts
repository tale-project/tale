// Explicit native proof, never a cached unit test. Requires an already-present
// immutable image with Bun and Docker. It does not activate host admission.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { withOperationBudget } from '../../src/operation-budget.ts';
import { isDockerNoSuchObject, runDocker } from '../../src/spawn-util.ts';

const image = process.env.SANDBOX_ADMISSION_TEST_IMAGE;
assert.match(
  image ?? '',
  /^sha256:[a-f0-9]{64}$/,
  'explicit immutable image required',
);
assert.ok(image);
const nonce = randomUUID().replaceAll('-', '');
const runnerName = `tale-admission-test-runner-${nonce}`;
const recordName = `tale-admission-test-record-${nonce}`;
const root = new URL('../../', import.meta.url);
function object(value: unknown): Record<string, unknown> {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return Object.fromEntries(Object.entries(value));
}
const manifest = object(
  JSON.parse(await readFile(new URL('../../package.json', root), 'utf8')),
);
assert.equal(typeof manifest.packageManager, 'string');
assert.ok(typeof manifest.packageManager === 'string');
const expectedBun = manifest.packageManager.replace('bun@', '');
const dockerCli = process.env.SANDBOX_ADMISSION_TEST_DOCKER_CLI;
let dockerCliSha256: string | undefined;
if (dockerCli !== undefined) {
  assert.equal(
    await realpath(dockerCli),
    dockerCli,
    'fixture CLI must be an absolute canonical file',
  );
  const stat = await lstat(dockerCli);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024 * 1024);
  dockerCliSha256 = createHash('sha256')
    .update(await readFile(dockerCli))
    .digest('hex');
}
const controller = new AbortController();
const abort = () => controller.abort(new Error('native fixture interrupted'));
process.on('SIGTERM', abort);
process.on('SIGINT', abort);
const directory = await mkdtemp(join(tmpdir(), 'tale-admission-test-'));
let runnerId: string | null = null;
let primary: unknown;
let receipt: unknown;

async function command(args: string[], timeoutMs = 10_000): Promise<string> {
  const result = await runDocker(args, {
    timeoutMs,
    stdoutMaxBytes: 32_768,
    stderrMaxBytes: 2048,
  });
  assert.equal(
    result.exitCode,
    0,
    `fixture Docker ${args[0]} failed: ${result.stderr}`,
  );
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stderrTruncated, false);
  return result.stdout.trim();
}

const projection =
  '{"id":{{json .Id}},"image":{{json .Image}},"nonce":{{json (index .Config.Labels "tale.test.host-admission")}},"owner":{{json (index .Config.Labels "tale.host-admission.container")}}}';

async function ownedId(
  name: string,
  timeoutMs: number,
): Promise<string | null> {
  const result = await runDocker(['inspect', '--format', projection, name], {
    timeoutMs,
    stdoutMaxBytes: 4096,
    stderrMaxBytes: 1024,
  });
  assert.equal(result.stdoutTruncated, false);
  assert.equal(result.stderrTruncated, false);
  if (result.exitCode !== 0) {
    assert.ok(
      isDockerNoSuchObject(result.stderr),
      'fixture cleanup identity unavailable',
    );
    return null;
  }
  const value = object(JSON.parse(result.stdout));
  assert.ok(typeof value.id === 'string');
  assert.match(value.id, /^[a-f0-9]{64}$/);
  assert.equal(value.image, image);
  assert.equal(value.nonce, nonce);
  if (name === recordName) assert.equal(value.owner, runnerId);
  return value.id;
}

try {
  await withOperationBudget(
    75_000,
    async () => {
      // Snapshot only this small source closure; never copy dependencies, workspaces,
      // credentials or daemon state. Native output binds the bytes actually run.
      const source: Record<string, string> = {};
      for (const path of [
        'src/host-admission-owner.ts',
        'src/spawn-util.ts',
        'src/operation-budget.ts',
        'tests/native/host-admission-client.ts',
      ]) {
        const bytes = await readFile(new URL(path, root));
        await mkdir(dirname(join(directory, path)), { recursive: true });
        await writeFile(join(directory, path), bytes, {
          flag: 'wx',
          mode: 0o600,
        });
        source[path] = createHash('sha256').update(bytes).digest('hex');
      }
      const inspected = await command([
        'image',
        'inspect',
        '--format',
        '{{.Id}}',
        image,
      ]);
      assert.equal(inspected, image);
      runnerId = await command([
        'create',
        '--pull',
        'never',
        '--name',
        runnerName,
        '--label',
        `tale.test.host-admission=${nonce}`,
        '--memory',
        '256m',
        '--cpus',
        '0.5',
        '--pids-limit',
        '128',
        '--network',
        'none',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--tmpfs',
        '/tmp:rw,nosuid,nodev,size=16m',
        '--mount',
        'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
        '--mount',
        `type=bind,src=${directory},dst=/tmp/admission,readonly`,
        ...(dockerCli === undefined
          ? []
          : [
              '--mount',
              `type=bind,src=${dockerCli},dst=/usr/local/bin/docker,readonly`,
            ]),
        '--env',
        `TEST_ADMISSION_NONCE=${nonce}`,
        '--entrypoint',
        'bun',
        image,
        '-e',
        'setInterval(() => {}, 1000)',
      ]);
      assert.match(runnerId, /^[a-f0-9]{64}$/);
      await command(['start', runnerId]);
      const raw = await command(
        [
          'exec',
          runnerId,
          'bun',
          '/tmp/admission/tests/native/host-admission-client.ts',
          'coordinate',
        ],
        60_000,
      );
      const result = object(JSON.parse(raw));
      assert.equal(result.schemaVersion, 1);
      assert.equal(result.bun, expectedBun);
      assert.deepEqual(result.source, source);
      if (dockerCliSha256 !== undefined)
        assert.equal(result.dockerCliSha256, dockerCliSha256);
      assert.equal(result.hotRestartRefused, true);
      assert.ok(Array.isArray(result.peers));
      const peers = result.peers.map((peer: unknown) => object(peer));
      assert.equal(peers.length, 2);
      assert.equal(new Set(peers.map((peer) => peer.pid)).size, 2);
      assert.ok(
        peers.every(
          (peer) =>
            typeof peer.acquired === 'boolean' &&
            typeof peer.pid === 'number' &&
            Number.isSafeInteger(peer.pid),
        ),
      );
      const winners = peers.filter((peer) => peer.acquired === true);
      assert.equal(winners.length, 1);
      const identity = object(winners[0]?.identity);
      assert.equal(identity.containerId, runnerId);
      assert.equal(identity.recordId, await ownedId(recordName, 5_000));
      receipt = {
        ...result,
        image,
        runnerId,
        scope:
          'disabled owner primitive; no phase execution or complete host admission',
      };
    },
    controller.signal,
  );
} catch (error) {
  primary = error;
} finally {
  // The mutation budget never cancels reconciliation. The cleanup budget is
  // separate and finite; uncertain identity is held, never guessed or pruned.
  try {
    await withOperationBudget(15_000, async () => {
      runnerId = await ownedId(runnerName, 5_000);
      for (const name of [recordName, runnerName]) {
        const id = await ownedId(name, 5_000);
        if (id === null) continue;
        await command(['rm', '--force', id], 5_000);
        const gone = await runDocker(['inspect', id], {
          timeoutMs: 5_000,
          stdoutMaxBytes: 4096,
          stderrMaxBytes: 1024,
        });
        assert.ok(
          gone.exitCode !== 0 &&
            isDockerNoSuchObject(gone.stderr) &&
            !gone.stderrTruncated,
        );
      }
    });
  } catch (cleanup) {
    primary = new AggregateError(
      primary === undefined ? [cleanup] : [primary, cleanup],
      'native admission fixture cleanup incomplete',
    );
  }
  await rm(directory, { recursive: true, force: true });
  process.off('SIGTERM', abort);
  process.off('SIGINT', abort);
}
if (primary !== undefined) throw primary;
console.log(JSON.stringify({ receipt, ownedObjectsRemoved: true }));
