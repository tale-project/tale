import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { buildDevCompose } from '../../../compose/generators/generate-dev-compose';
import { runtimeProcessEnvironment } from '../../../deployment/runtime-command';
import {
  colourDocument,
  DOTENV,
  HOST,
  SERVICE_CONFIG,
  statefulDocument,
} from './compile-fixture';
import {
  interpolateDeep,
  interpolationSource,
  referencedNamesDeep,
  type InterpolationPath,
} from './interpolate';
import { serviceEnvironment } from './translate';

/**
 * The oracle of design D-10 (R-11): the environment and image the compiler
 * hands each service equal what `docker compose config` resolves, for every
 * generated document and the repository's compose.yml, run under `env -i`
 * with exactly the variables of the path, so an ambient variable of the
 * machine cannot make it pass. Skipped on Windows, without Docker, or without
 * its Compose plugin outside CI; a Linux CI runner with Docker but no Compose
 * fails it.
 */

const REPOSITORY_COMPOSE = fileURLToPath(
  new URL('../../../../../../../compose.yml', import.meta.url),
);

/** A .env that exercises Compose's grammar beside the deployment's keys. */
const ORACLE_DOTENV = [
  DOTENV,
  'export EXPORTED=exported-value',
  "SINGLE='literal $HOST \\n'",
  'DOUBLE="line\\nnext \\"quoted\\" ${HOST} \\$5"',
  'UNQUOTED=plain # a comment',
  'DERIVED=${SITE_URL}/derived',
  'DEFAULTED=${NOT_IN_ENV:-fallback}',
  'SHADOWED=from-file',
  'FROM_SHELL',
  'SANDBOX_RUNTIME=runc',
  '',
].join('\n');

/** The workspace's process: a shadow of a .env key, and a bare key's value. */
const WORKSPACE_PROCESS = {
  SHADOWED: 'from-shell',
  FROM_SHELL: 'shell-value',
  OBJECT_STORE_BUCKET: 'shell-bucket',
};

function composeAvailable(): boolean {
  // Windows runners have Docker for Windows containers, and the documents
  // name Linux paths: the oracle runs where the stack runs.
  if (process.platform === 'win32') return false;
  const docker = Bun.which('docker');
  if (!docker) return false;
  return (
    Bun.spawnSync([docker, 'compose', 'version'], {
      env: runtimeProcessEnvironment(),
    }).exitCode === 0
  );
}

const available = composeAvailable();
const required =
  process.env.CI !== undefined &&
  process.platform === 'linux' &&
  Bun.which('docker') !== null;

function composeConfig(
  document: unknown,
  variables: Record<string, string>,
): Record<
  string,
  { environment?: Record<string, string | null>; image?: string }
> {
  const directory = mkdtempSync(join(tmpdir(), 'tale-compose-oracle-'));
  try {
    writeFileSync(join(directory, 'compose.yml'), stringify(document));
    writeFileSync(join(directory, '.env'), ORACLE_DOTENV);
    const run = Bun.spawnSync(
      [
        Bun.which('docker') ?? 'docker',
        'compose',
        '--project-directory',
        directory,
        '-f',
        join(directory, 'compose.yml'),
        '-p',
        'tale-oracle',
        'config',
        '--format',
        'json',
        '--no-path-resolution',
      ],
      // env -i: Docker's own plumbing and exactly the path's variables.
      { cwd: directory, env: { ...runtimeProcessEnvironment(), ...variables } },
    );
    if (run.exitCode !== 0)
      throw new Error(`docker compose config failed: ${run.stderr.toString()}`);
    return (JSON.parse(run.stdout.toString()) as { services: never }).services;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function documents(): {
  name: string;
  path: InterpolationPath;
  compose: unknown;
}[] {
  const project = mkdtempSync(join(tmpdir(), 'tale-oracle-dev-'));
  try {
    return [
      { name: 'stateful', path: 'workspace', compose: statefulDocument() },
      { name: 'blue', path: 'workspace', compose: colourDocument('blue') },
      { name: 'green', path: 'workspace', compose: colourDocument('green') },
      {
        name: 'dev',
        path: 'workspace',
        compose: buildDevCompose(SERVICE_CONFIG, HOST, 3000, {
          projectDir: project,
        }),
      },
      {
        name: 'compose.yml, managed',
        path: 'managed',
        compose: parse(readFileSync(REPOSITORY_COMPOSE, 'utf8')),
      },
      {
        name: 'compose.yml, workspace',
        path: 'workspace',
        compose: parse(readFileSync(REPOSITORY_COMPOSE, 'utf8')),
      },
    ];
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

describe.skipIf(!available && !required)(
  'interpolation equals docker compose config',
  () => {
    test('Docker Compose is available here', () => {
      expect(available, 'docker compose is required on a Linux CI runner').toBe(
        true,
      );
    });

    test('Docker plumbing variables are never referenced by a document', () => {
      for (const { name, compose } of documents()) {
        const referenced = referencedNamesDeep(compose);
        for (const plumbing of Object.keys(runtimeProcessEnvironment()))
          expect(referenced.has(plumbing), `${name}: ${plumbing}`).toBe(false);
      }
    });

    for (const { name, path } of documents())
      test(name, () => {
        const document = documents().find(
          (item) => item.name === name,
        )?.compose;
        const source = interpolationSource(path, {
          dotenv: ORACLE_DOTENV,
          processEnvironment: WORKSPACE_PROCESS,
          documents: [document],
        });
        if (path === 'workspace') expect(source.shadowed).toContain('SHADOWED');
        // The path's map is exactly what Compose sees: the workspace's
        // process snapshot, or nothing beyond .env for a managed deployment.
        const oracle = composeConfig(
          document,
          path === 'workspace' ? WORKSPACE_PROCESS : {},
        );
        const services = (
          document as { services: Record<string, Record<string, unknown>> }
        ).services;
        for (const [service, raw] of Object.entries(services)) {
          const interpolated = interpolateDeep(raw, (variable) =>
            Object.hasOwn(source.variables, variable)
              ? source.variables[variable]
              : undefined,
          );
          const ours = serviceEnvironment(interpolated, source.variables, {
            '.env': ORACLE_DOTENV,
          });
          expect(ours.refusals, service).toEqual([]);
          const theirs = Object.fromEntries(
            Object.entries(oracle[service]?.environment ?? {}).flatMap(
              ([key, value]) =>
                value === null ? [] : [[key, value.replaceAll('$$', '$')]],
            ),
          );
          expect(ours.environment, `${name}: ${service}`).toEqual(theirs);
          // The oracle compares the grammar, not two empty maps.
          if (raw.env_file !== undefined)
            expect(theirs.DOUBLE, `${name}: ${service}`).toBe(
              `line\nnext "quoted" ${source.variables.HOST} $5`,
            );
          expect(interpolated.image, `${name}: ${service}`).toBe(
            oracle[service]?.image,
          );
        }
      });
  },
);
