import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  childEnvironment,
  json,
  outputPath,
  runLogged,
  sources,
} from './common.ts';
import {
  compareDialogBundle,
  dialogBundleReference,
} from './dialog-bundles.ts';

async function hashes(
  directory: string,
  prefix = '',
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(result, await hashes(directory, name));
    else if (entry.isFile())
      result[name] = createHash('sha256')
        .update(await readFile(join(directory, name)))
        .digest('hex');
    else assert.fail('Build evidence contains a symlink or special file');
  }
  return result;
}

const source = await sources();
try {
  assert.equal(
    process.versions.node,
    source.node,
    'Build Node differs from platform pin',
  );
  const bun = execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(bun, source.bun, 'Build Bun differs from root pin');
  const reference =
    source.mode === 'dialog' ? await dialogBundleReference() : undefined;
  // Installing is preparation, outside the measured cgroup. Keep dev deps:
  // production NODE_ENV during installation would omit Vite and test tooling.
  await runLogged('bun', ['install', '--frozen-lockfile'], {
    cwd: source.baselinePath,
    log: outputPath('baseline-install.log'),
    timeoutMs: 600_000,
    env: childEnvironment({ NODE_ENV: 'development' }),
  });
  await mkdir(outputPath('bundles'));
  const built: Record<string, unknown> = {};
  for (const [name, path] of [
    ['baseline', source.baselinePath],
    ['candidate', source.candidatePath],
  ] as const) {
    const started = Date.now();
    await runLogged('bun', ['run', 'build'], {
      cwd: join(path, 'services/platform'),
      log: outputPath(`${name}-build.log`),
      timeoutMs: 900_000,
    });
    const directory = join(path, 'services/platform/dist');
    await readFile(join(directory, 'index.html'));
    const assets = await hashes(directory);
    assert(
      Object.keys(assets).some((file) => file.endsWith('.js.map')),
      'Production build has no source maps',
    );
    assert.equal(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        cwd: path,
        encoding: 'utf8',
      }).trim(),
      '',
      'Build changed tracked source',
    );
    await cp(directory, outputPath(`bundles/${name}`), {
      recursive: true,
      errorOnExist: true,
    });
    const parity = reference
      ? compareDialogBundle(assets, reference.manifest.arms[name].files)
      : undefined;
    if (reference)
      await json(`dialog-${name}-bundle-parity.json`, {
        ...parity,
        harnessCandidate: source.candidate,
        productCommit: reference.manifest[name],
        historicalRun: reference.manifest.run,
        artifactId: reference.manifest.artifactId,
        artifactZipSha256: reference.manifest.artifactZipSha256,
        manifestSha256: reference.manifestSha256,
        actual: assets,
      });
    built[name] = {
      command: ['bun', 'run', 'build'],
      node: process.versions.node,
      bun,
      elapsedMs: Date.now() - started,
      assets,
      ...(parity ? { dialogBundleParity: parity } : {}),
    };
    await json('builds.json', built);
    if (parity)
      assert(
        parity.matches,
        'Historical dialog bundle drift; retained actual manifest, refuse before runtime',
      );
  }
} catch (error) {
  await json('build-failure.json', { error: String(error) });
  throw error;
}
