// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import knipConfig from '../../../../knip.config';
import storybookConfig from '../../.storybook/main';

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');

describe('frontend entry discovery', () => {
  it('reports orphan modules while following route imports in every frontend directory', () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'tale-knip-entries-'));
    const directories = ['features', 'hooks', 'components'];

    try {
      mkdirSync(path.join(fixture, 'app/routes'), { recursive: true });
      for (const directory of directories) {
        const target = path.join(fixture, 'app', directory);
        mkdirSync(target, { recursive: true });
        writeFileSync(
          path.join(target, 'connected.ts'),
          'export const connected = true;',
        );
        writeFileSync(
          path.join(target, 'orphan.ts'),
          'export const orphan = true;',
        );
      }
      writeFileSync(
        path.join(fixture, 'app/routes/index.tsx'),
        directories
          .map((directory) => `import '../${directory}/connected';`)
          .join('\n'),
      );
      writeFileSync(
        path.join(fixture, 'package.json'),
        JSON.stringify({ private: true }),
      );
      const { entry, project } = knipConfig.workspaces['services/platform'];
      writeFileSync(
        path.join(fixture, 'knip.json'),
        JSON.stringify({ entry, project }),
      );

      const result = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, 'node_modules/knip/bin/knip.js'),
          '--directory',
          fixture,
          '--files',
          '--reporter',
          'json',
          '--no-progress',
        ],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(1);
      const report = z
        .object({
          issues: z.array(
            z.object({
              file: z.string(),
              files: z.array(z.object({ name: z.string() })),
            }),
          ),
        })
        .parse(JSON.parse(result.stdout));
      const unusedFiles = report.issues
        .filter((issue) => issue.files.length > 0)
        .map((issue) => issue.file)
        .sort();
      expect(unusedFiles).toEqual(
        directories.map((directory) => `app/${directory}/orphan.ts`).sort(),
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 45_000);

  it('includes every frontend story in the actual Storybook configuration', () => {
    const storyPatterns = z.array(z.string()).parse(storybookConfig.stories);
    const discovered = new Set(
      storyPatterns.flatMap((pattern) => {
        return globSync(pattern, {
          cwd: path.join(PLATFORM_ROOT, '.storybook'),
        }).map((file) => path.resolve(PLATFORM_ROOT, '.storybook', file));
      }),
    );
    const orphanStories = globSync('app/**/*.stories.@(ts|tsx)', {
      cwd: PLATFORM_ROOT,
    }).filter((file) => !discovered.has(path.join(PLATFORM_ROOT, file)));
    expect(orphanStories).toEqual([]);
  });
});
