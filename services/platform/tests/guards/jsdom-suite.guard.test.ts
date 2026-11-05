// @vitest-environment node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The platform's jsdom suite is `vitest.ui.config.ts`, the one `test:ui` runs
 * and CI shards. `vitest.config.ts` held a second one, a `client` project no
 * script named but every bare `bunx vitest --run` ran: it ran the component
 * tests without `css: true`, so the date picker in the API key dialog stayed
 * unclickable there while CI passed it, and it left the route tests out.
 *
 * This asks Vitest which files each config runs, globbed as `vitest list
 * --filesOnly` globs them, so a project of `vitest.config.ts` that runs in
 * jsdom, or runs a file of the suite again, fails here. A file elsewhere that
 * needs a DOM opts in to jsdom with a `@vitest-environment` comment in its own
 * project.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SELF = path.relative(PLATFORM_ROOT, fileURLToPath(import.meta.url));

/** Starts the probe's report line: the Storybook plugin writes to stdout too. */
const MARKER = 'jsdom-suite-guard ';

/** Prints every project of each config: its name, environment and files. */
const PROBE = `
import path from 'node:path';
import { createVitest } from 'vitest/node';

const report = {};
for (const config of ['vitest.config.ts', 'vitest.ui.config.ts']) {
  const vitest = await createVitest('test', {
    root: process.cwd(),
    config,
    watch: false,
  });
  try {
    const specifications = await vitest.globTestSpecifications();
    report[config] = vitest.projects.map((project) => ({
      name: project.name,
      environment: project.config.environment,
      files: specifications
        .filter((specification) => specification.project === project)
        .map((specification) =>
          path.relative(process.cwd(), specification.moduleId),
        ),
    }));
  } finally {
    await vitest.close();
  }
}
console.log(${JSON.stringify(MARKER)} + JSON.stringify(report));
`;

const projectsSchema = z.array(
  z.object({
    name: z.string(),
    environment: z.string(),
    files: z.array(z.string()),
  }),
);
const reportSchema = z.object({
  'vitest.config.ts': projectsSchema,
  'vitest.ui.config.ts': projectsSchema,
});

describe('the platform jsdom suite', () => {
  let report: z.infer<typeof reportSchema>;

  beforeAll(() => {
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', PROBE],
      {
        cwd: PLATFORM_ROOT,
        encoding: 'utf8',
        // What the Vitest CLI sets before it loads a config. The Storybook
        // plugin reads `VITEST`: without it, its project claims every test.
        env: {
          ...process.env,
          TEST: 'true',
          VITEST: 'true',
          NODE_ENV: process.env.NODE_ENV ?? 'test',
        },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 90_000,
      },
    );
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const line = result.stdout
      .split('\n')
      .find((candidate) => candidate.startsWith(MARKER));
    if (line === undefined)
      throw new Error(`The probe printed no report:\n${result.stdout}`);
    report = reportSchema.parse(JSON.parse(line.slice(MARKER.length)));
  }, 120_000);

  it('is vitest.ui.config.ts, jsdom over the component, feature, hook and route tests', () => {
    const [suite, ...others] = report['vitest.ui.config.ts'];
    expect(others).toEqual([]);
    expect(suite?.environment).toBe('jsdom');
    for (const directory of ['components', 'features', 'hooks', 'routes']) {
      expect(
        suite?.files.some((file) => file.startsWith(`app/${directory}/`)),
        directory,
      ).toBe(true);
    }
  });

  it('has no jsdom project in vitest.config.ts, which a bare run runs whole', () => {
    const projects = report['vitest.config.ts'];
    expect(projects.flatMap((project) => project.files)).toContain(SELF);
    expect(
      projects
        .filter((project) => project.environment === 'jsdom')
        .map((project) => project.name),
    ).toEqual([]);
  });

  it('runs none of its files again under vitest.config.ts', () => {
    const suite = new Set(
      report['vitest.ui.config.ts'].flatMap((project) => project.files),
    );
    expect(
      report['vitest.config.ts'].flatMap((project) => {
        const again = project.files.filter((file) => suite.has(file));
        return again.length === 0
          ? []
          : [`${project.name}: ${again.length} files, ${again[0]} first`];
      }),
    ).toEqual([]);
  });
});
