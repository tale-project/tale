// Dependency-free: validate the two immutable sources before installing code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function fullSha(value) {
  assert.equal(value?.length, 40, 'Expected a full lowercase commit SHA');
  assert.match(
    value ?? '',
    /^[a-f0-9]{40}$/,
    'Expected a full lowercase commit SHA',
  );
  return value;
}

export function assertCandidate(expected, actual, dirty) {
  assert.equal(
    actual,
    fullSha(expected),
    'Checked-out candidate differs from event SHA',
  );
  assert.equal(dirty, '', 'Candidate has tracked changes');
}

export function sharedServerChange(path) {
  return (
    path === 'bun.lock' ||
    /^services\/platform\/[^/]+\.(?:ts|mjs)$/.test(path) ||
    path.startsWith('services/proxy/') ||
    /(^|\/)package\.json$/.test(path) ||
    /(^|\/)tsconfig[^/]*\.json$/.test(path) ||
    [
      'patches/',
      'services/platform/backend/',
      'services/platform/lib/',
      'services/platform/messages/',
      'packages/ui/',
      'packages/shared/',
      'configs/platform/',
      'services/db/',
    ].some((prefix) => path.startsWith(prefix))
  );
}

export function assertSharedServer(changed) {
  const incompatible = changed.filter(sharedServerChange);
  assert.deepEqual(
    incompatible,
    [],
    `Shared API requires identical server and dependency inputs: ${incompatible.join(', ')}`,
  );
}

export function platformNode(source) {
  const version =
    /^FROM node:([0-9]+\.[0-9]+\.[0-9]+)-[^\n]+ AS node-bin$/m.exec(
      source,
    )?.[1];
  assert(version, 'Platform Dockerfile must pin the Node binary stage');
  return version;
}

export async function prepareSources(env = process.env, cwd = process.cwd()) {
  const temporary = resolve(env.RUNNER_TEMP ?? '');
  const output = resolve(temporary, 'browser-performance');
  assert(
    env.RUNNER_TEMP &&
      output.startsWith(`${temporary}/`) &&
      !/[\r\n]/.test(output),
    'Evidence must be under RUNNER_TEMP',
  );
  await mkdir(output, { mode: 0o700 });
  const deadline = Date.now() + 32 * 60_000;
  const receipt = { status: 'preparing', output, deadline };
  assert(env.GITHUB_ENV, 'Actions environment path is required');
  await appendFile(
    env.GITHUB_ENV,
    `BENCH_OUTPUT=${output}\nBENCH_DEADLINE_MS=${deadline}\n`,
  );
  const save = () =>
    writeFile(`${output}/sources.json`, JSON.stringify(receipt, null, 2));
  await save();
  try {
    const baseline = fullSha(env.BASELINE_SHA);
    const candidate = fullSha(env.CANDIDATE_SHA);
    const git = (...args) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    assertCandidate(
      candidate,
      git('rev-parse', 'HEAD'),
      git('status', '--porcelain', '--untracked-files=no'),
    );
    git('fetch', '--no-tags', '--depth=1', 'origin', baseline);
    assert.equal(
      git('rev-parse', `${baseline}^{commit}`),
      baseline,
      'Fetched baseline differs from event SHA',
    );
    // A shallow candidate fetch may not contain the ancestry path. Fetch only
    // this exact candidate's history, never the moving main branch.
    if (git('rev-parse', '--is-shallow-repository') === 'true')
      git('fetch', '--no-tags', '--unshallow', 'origin', candidate);
    git('merge-base', '--is-ancestor', baseline, candidate);
    const changed = git(
      'diff',
      '--no-renames',
      '--name-only',
      baseline,
      candidate,
    )
      .split('\n')
      .filter(Boolean);
    assertSharedServer(changed);
    const candidateNode = platformNode(
      git('show', `${candidate}:services/platform/Dockerfile`),
    );
    assert.equal(
      platformNode(git('show', `${baseline}:services/platform/Dockerfile`)),
      candidateNode,
      'Node pins differ',
    );
    const manifest = JSON.parse(await readFile(`${cwd}/package.json`, 'utf8'));
    assert.match(
      manifest.packageManager ?? '',
      /^bun@[0-9]+\.[0-9]+\.[0-9]+$/,
      'Root must pin Bun',
    );
    const baselinePath = resolve(temporary, 'browser-performance-baseline');
    git('worktree', 'add', '--detach', baselinePath, baseline);
    const inputs = Object.fromEntries(
      git('ls-tree', '-r', '--name-only', candidate)
        .split('\n')
        .filter(
          (path) =>
            path === 'bun.lock' ||
            /^services\/platform\/[^/]+\.(?:ts|mjs)$/.test(path) ||
            path.startsWith('services/proxy/') ||
            /(^|\/)package\.json$/.test(path) ||
            /(^|\/)tsconfig[^/]*\.json$/.test(path) ||
            path.startsWith('patches/'),
        )
        .map((path) => [
          path,
          {
            gitBlob: git('rev-parse', `${candidate}:${path}`),
            sha256: createHash('sha256')
              .update(
                execFileSync('git', ['show', `${candidate}:${path}`], {
                  cwd,
                  timeout: 5000,
                }),
              )
              .digest('hex'),
          },
        ]),
    );
    Object.assign(receipt, {
      status: 'ready',
      identicalSharedInputs: inputs,
      baseline,
      candidate,
      workflowMergeSha: env.GITHUB_SHA,
      baselineTree: git('rev-parse', `${baseline}^{tree}`),
      candidateTree: git('rev-parse', `${candidate}^{tree}`),
      baselinePath,
      candidatePath: cwd,
      node: candidateNode,
      bun: manifest.packageManager.slice(4),
      changed,
    });
    await save();
  } catch (error) {
    Object.assign(receipt, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    await save();
    throw error;
  }
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await prepareSources();
