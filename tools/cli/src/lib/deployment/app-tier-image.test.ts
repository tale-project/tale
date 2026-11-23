import { expect, test } from 'bun:test';

import { CliError, ExitCode } from '../../utils/fail';
import { APP_IN_BACKEND_LABEL } from '../compose/app-tier';
import { imageServesApp } from './app-tier-image';
import { AUTOMATION_PROTOCOL_LABEL } from './automation-model';
import type { RuntimeDependencies } from './runtime-model';

const reference = `ghcr.io/tale-project/tale/tale-platform@sha256:${'c'.repeat(64)}`;

const ok = (value: unknown) => ({
  success: true,
  exitCode: 0,
  stdout: typeof value === 'string' ? value : JSON.stringify(value),
  stderr: '',
});

/** One image as `docker image inspect` prints it, with these labels. */
const image = (labels: Record<string, string> | null | undefined) => ({
  Id: `sha256:${'d'.repeat(64)}`,
  Os: 'linux',
  Architecture: 'amd64',
  RepoDigests: [reference],
  Config: labels === undefined ? {} : { Labels: labels },
});

/** A host whose `docker image inspect` answers this, and the argv it saw. */
function host(answer: unknown): {
  deps: RuntimeDependencies;
  argv: string[][];
} {
  const argv: string[][] = [];
  return {
    argv,
    deps: {
      exec: async (_command, args) => {
        argv.push([...args]);
        return ok(answer);
      },
    },
  };
}

test('an image that carries the label serves the app from its backend process', async () => {
  const { deps, argv } = host([
    image({ [APP_IN_BACKEND_LABEL]: '1', [AUTOMATION_PROTOCOL_LABEL]: '2' }),
  ]);
  expect(await imageServesApp(reference, deps)).toBe(true);
  // Read under the reference it was given: the digest a colour's compose names.
  expect(argv).toEqual([['image', 'inspect', reference]]);
});

test('an image without the label is one from before, whatever else it says', async () => {
  const without: Array<Record<string, string> | null | undefined> = [
    {},
    null,
    undefined,
    { [AUTOMATION_PROTOCOL_LABEL]: '2' },
    { [APP_IN_BACKEND_LABEL]: '0' },
    { [APP_IN_BACKEND_LABEL]: 'true' },
    { 'io.tale.app-in-backend ': '1' },
  ];
  for (const labels of without)
    expect(await imageServesApp(reference, host([image(labels)]).deps)).toBe(
      false,
    );
});

test('an image that is not on the host is a failed read that names the image, never an old image', async () => {
  const failure = await imageServesApp(reference, {
    exec: async () => ({
      success: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error response from daemon: No such image',
    }),
  }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CliError);
  expect((failure as CliError).info.code).toBe(ExitCode.ExternalDep);
  expect((failure as CliError).message).toBe(
    `Could not read which services the selected image runs as: \`docker image inspect ${reference}\` failed.`,
  );
});

test('an answer that is no single image is refused as it is', async () => {
  await expect(imageServesApp(reference, host([]).deps)).rejects.toThrow();
  await expect(
    imageServesApp(
      reference,
      host([
        image({ [APP_IN_BACKEND_LABEL]: '1' }),
        image({ [APP_IN_BACKEND_LABEL]: '1' }),
      ]).deps,
    ),
  ).rejects.toThrow();
  await expect(
    imageServesApp(reference, host('not json').deps),
  ).rejects.toThrow();
});
