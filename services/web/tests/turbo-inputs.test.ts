// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  PRODUCT_SCREENSHOTS,
  PRODUCT_SCREENSHOT_LOCALES,
} from '../app/content/product-screenshots';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

/** Every outside file the product-capture provenance suite reads or checks. */
function captureFiles(): string[] {
  return [
    'services/docs/public/images/manifest.json',
    ...Object.values(PRODUCT_SCREENSHOTS).flatMap(({ source }) =>
      PRODUCT_SCREENSHOT_LOCALES.map(
        (locale) =>
          `services/docs/public/images/platform/${locale === 'en' ? '' : `${locale}/`}${source}.webp`,
      ),
    ),
  ];
}

interface DryRunTask {
  taskId: string;
  directory: string;
  inputs: Record<string, string>;
}

/** Ask Turbo for the actual hashes, rather than trusting a matching glob. */
function hashedTestInputs(): Map<string, string> {
  const run = spawnSync(
    'bunx',
    [
      'turbo',
      'run',
      'test',
      '--filter=@tale/web',
      '--dry=json',
      '--cache=local:,remote:',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error) {
    throw new Error(`turbo --dry=json did not run: ${run.error.message}`, {
      cause: run.error,
    });
  }
  if (run.status !== 0) {
    throw new Error(`turbo --dry=json exited ${run.status}: ${run.stderr}`);
  }
  const start = run.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`turbo --dry=json printed no JSON: ${run.stdout}`);
  }
  const { tasks } = JSON.parse(run.stdout.slice(start)) as {
    tasks: DryRunTask[];
  };
  const task = tasks.find(({ taskId }) => taskId === '@tale/web#test');
  if (!task) throw new Error('turbo --dry=json omitted @tale/web#test');
  return new Map(
    Object.entries(task.inputs).map(([file, hash]) => [
      path
        .relative(REPO_ROOT, path.join(REPO_ROOT, task.directory, file))
        .split(path.sep)
        .join('/'),
      hash,
    ]),
  );
}

describe('Turbo product-capture inputs', () => {
  let hashes: Map<string, string>;

  beforeAll(() => {
    hashes = hashedTestInputs();
  }, 60_000);

  it('keeps root task inputs and hashes its own source files', () => {
    const { tasks } = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'services/web/turbo.json'), 'utf8'),
    ) as { tasks: Record<string, { inputs?: string[] }> };
    expect(tasks.test?.inputs?.slice(0, 2)).toEqual([
      '$TURBO_EXTENDS$',
      '$TURBO_DEFAULT$',
    ]);
    for (const file of [
      'services/web/tests/turbo-inputs.test.ts',
      'services/web/app/content/product-screenshots.ts',
    ]) {
      expect(
        hashes.get(file),
        `@tale/web#test does not hash ${file}`,
      ).toBeTruthy();
    }
  });

  it('hashes the docs manifest and every registered localized source', () => {
    const files = captureFiles();
    const missing = files.filter((file) => !hashes.get(file));
    expect(
      missing,
      'Product-capture tests read files outside @tale/web: add their $TURBO_ROOT$ inputs to services/web/turbo.json',
    ).toEqual([]);
  });
});
