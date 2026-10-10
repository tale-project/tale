import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

const workflow = parse(
  await readFile(
    new URL(
      '../../../.github/workflows/cleanup-pr-images.yml',
      import.meta.url,
    ),
    'utf8',
  ),
) as { jobs: { delete: { steps: { name: string; run: string }[] } } };
const command = workflow.jobs.delete.steps.find(
  (step) => step.name === 'Delete PR-tagged versions',
)!.run;
const ownTag = `pr-7-sha-${'a'.repeat(40)}`;
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
type Version = {
  id: number | string;
  metadata: { container: { tags: string[] } };
};
type Scenario = {
  versions: Version[];
  changedTags?: Record<string, string[] | null>;
  readErrors?: Record<string, number>;
  deleteErrors?: Record<string, number>;
  parallelProof?: boolean;
};
const version = (id: number | string, tags = [ownTag]): Version => ({
  id,
  metadata: { container: { tags } },
});

test('cleanup rechecks version ownership before deletion and awaits every bounded worker', () => {
  expect(command).toContain('all(.metadata.container.tags[]; test(');
  expect(command).toContain('all(.[]; test(');
  expect(command).toContain('"${#pids[@]}" -eq 3');
  expect(command).toContain('if ! wait "$pid"; then worker_failed=true; fi');
  expect(command).toContain("awk '!seen[$0]++'");
});

describe.skipIf(process.platform === 'win32')('PR image cleanup', () => {
  async function execute(scenario: Scenario, pr = '7') {
    const root = await mkdtemp(join(tmpdir(), 'tale-pr-image-cleanup-'));
    roots.push(root);
    const bin = join(root, 'bin');
    await mkdir(bin);
    await mkdir(join(root, 'active'));
    await writeFile(join(root, 'scenario.json'), JSON.stringify(scenario));
    const script = join(bin, 'gh');
    await writeFile(
      script,
      `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.FIXTURE_ROOT;
const scenario = JSON.parse(readFileSync(join(root, 'scenario.json'), 'utf8'));
const args = process.argv.slice(2);
const path = args.find(value => value.startsWith('/orgs/'));
const query = args[args.indexOf('--jq') + 1];
const match = path.match(/\\/versions\\/([0-9]+)$/);
const id = match?.[1];
const operation = id ? (args.includes('DELETE') ? 'delete' : 'read') : 'list';
const marker = join(root, 'active', String(process.pid));
if (id) writeFileSync(marker, 'active');
const active = readdirSync(join(root, 'active')).length;
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify({ operation, id, active }) + '\\n');
if (scenario.parallelProof && operation === 'read' && Number(id) <= 3) {
  const barrier = join(root, 'barrier');
  if (active === 3) writeFileSync(barrier, 'ready');
  for (let attempt = 0; attempt < 500 && !existsSync(barrier); attempt++) await Bun.sleep(10);
}
await Bun.sleep(10);
if (id) unlinkSync(marker);
const status = scenario[operation === 'read' ? 'readErrors' : 'deleteErrors']?.[id];
if (status) { console.error('gh: synthetic failure (HTTP ' + status + ')'); process.exit(1); }
if (operation === 'delete') process.exit(0);
let data = scenario.versions;
if (id) {
  data = scenario.versions.find(item => String(item.id) === id);
  if (Object.hasOwn(scenario.changedTags ?? {}, id))
    data = { ...data, metadata: { container: { tags: scenario.changedTags[id] } } };
}
const child = Bun.spawn(['jq', '-r', query], { stdin: 'pipe', stdout: 'inherit', stderr: 'inherit' });
child.stdin.write(JSON.stringify(data)); child.stdin.end();
process.exit(await child.exited);
`,
    );
    await chmod(script, 0o755);
    await writeFile(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
    await chmod(join(bin, 'sleep'), 0o755);
    const summary = join(root, 'summary');
    const child = Bun.spawn(['bash', '-e', '-o', 'pipefail', '-c', command], {
      cwd: root,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        FIXTURE_ROOT: root,
        PR: pr,
        SVC: 'platform',
        OWNER: 'synthetic-owner',
        GH_TOKEN: 'synthetic-fixture-token',
        GITHUB_STEP_SUMMARY: summary,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const calls = (await Bun.file(join(root, 'calls.jsonl')).exists())
      ? (await readFile(join(root, 'calls.jsonl'), 'utf8'))
          .trim()
          .split('\n')
          .map(
            (line) =>
              JSON.parse(line) as {
                operation: string;
                id?: string;
                active: number;
              },
          )
      : [];
    return {
      status,
      output: stdout + stderr,
      calls,
      summary: (await Bun.file(summary).exists())
        ? await readFile(summary, 'utf8')
        : '',
    };
  }

  test('only versions whose every tag belongs to this exact PR are deleted', async () => {
    const result = await execute({
      versions: [
        version(1),
        version(2, [ownTag, `sha-${'a'.repeat(40)}`]),
        version(3, [ownTag, 'v0.5.64']),
        version(4, [ownTag, `candidate-sha-${'a'.repeat(40)}`]),
        version(5, [ownTag, `pr-8-sha-${'a'.repeat(40)}`]),
        version(6, ['pr-7-sha-short']),
        version(7, []),
      ],
    });
    expect(result.status, result.output).toBe(0);
    expect(
      result.calls
        .filter((call) => call.operation === 'delete')
        .map((call) => call.id),
    ).toEqual(['1']);
    expect(result.summary).toContain('Deleted: 1');
  });

  test('new shared tags between listing and deletion preserve the entire version', async () => {
    const result = await execute({
      versions: [version(1)],
      changedTags: { '1': [ownTag, 'latest'] },
    });
    expect(result.status, result.output).toBe(0);
    expect(result.calls.filter((call) => call.operation === 'delete')).toEqual(
      [],
    );
    expect(result.summary).toContain('Shared versions preserved: 1');
  });

  test.each([403, 503])(
    'ownership read failure %i prevents DELETE and fails the job',
    async (code) => {
      const result = await execute({
        versions: [version(1)],
        readErrors: { '1': code },
      });
      expect(result.status).not.toBe(0);
      expect(
        result.calls.filter((call) => call.operation === 'delete'),
      ).toEqual([]);
      expect(result.summary).toContain('Failures: 1');
    },
  );

  test('malformed ownership metadata fails closed', async () => {
    const result = await execute({
      versions: [version(1)],
      changedTags: { '1': null },
    });
    expect(result.status).not.toBe(0);
    expect(result.calls.filter((call) => call.operation === 'delete')).toEqual(
      [],
    );
  });

  test.each(['../1', '-1', '0'])(
    'invalid listed ID %s aborts before mutation',
    async (id) => {
      const result = await execute({ versions: [version(1), version(id)] });
      expect(result.status).not.toBe(0);
      expect(result.calls.filter((call) => call.operation !== 'list')).toEqual(
        [],
      );
    },
  );

  test('invalid PR identifiers fail before any API call', async () => {
    const result = await execute({ versions: [version(1)] }, '7x');
    expect(result.status).not.toBe(0);
    expect(result.calls).toEqual([]);
  });

  test('repeated IDs are read and deleted only once', async () => {
    const result = await execute({ versions: [version(1), version(1)] });
    expect(result.status, result.output).toBe(0);
    expect(
      result.calls.filter((call) => call.operation === 'read'),
    ).toHaveLength(1);
    expect(
      result.calls.filter((call) => call.operation === 'delete'),
    ).toHaveLength(1);
    expect(result.summary).toContain('Deleted: 1');
  });

  test('404 read/delete races retain accurate already-gone counts', async () => {
    const result = await execute({
      versions: [version(1), version(2)],
      readErrors: { '1': 404 },
      deleteErrors: { '2': 404 },
    });
    expect(result.status, result.output).toBe(0);
    expect(result.summary).toContain('Already gone (404): 2');
    expect(result.summary).toContain('Failures: 0');
  });

  test('three workers overlap and all finish even if one deletion fails', async () => {
    const result = await execute({
      versions: Array.from({ length: 9 }, (_, index) => version(index + 1)),
      deleteErrors: { '2': 403 },
      parallelProof: true,
    });
    expect(result.status).not.toBe(0);
    expect(
      result.calls.filter((call) => call.operation === 'delete'),
    ).toHaveLength(9);
    expect(Math.max(...result.calls.map((call) => call.active))).toBe(3);
    expect(result.summary).toContain('Deleted: 8');
    expect(result.summary).toContain('Failures: 1');
  });
});
