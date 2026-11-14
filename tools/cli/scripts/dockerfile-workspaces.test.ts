import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  copiedManifests,
  describeFindings,
  dockerfileWorkspaceFindings,
  reachesContext,
  rootInstallDockerfiles,
  workspaceManifests,
} from './dockerfile-workspaces';

/**
 * The root-install images (services/*, the plop service template) copy a
 * hand-kept list of workspace manifests and re-include them past their
 * dockerignores. This guard holds every such list to the workspace it installs:
 * `bun run check` runs it, so a new workspace or dependency fails until each
 * list follows it. The first case reads the real repository; the rest pin the
 * rule on a fixture, so a silently empty scope cannot pass.
 */

const repository = resolve(import.meta.dir, '../../..');
const temporary: string[] = [];

afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function write(root: string, file: string, content: string) {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), content);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A miniature workspace: packages/shared and packages/incus (libraries every
 * image takes), services/app (depends on shared), services/lib (depends on
 * nothing, but app reaches it through its own dependency list).
 */
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dockerfile-workspaces-'));
  temporary.push(root);
  await write(
    root,
    'package.json',
    json({ name: 'fixture', workspaces: ['packages/*', 'services/*'] }),
  );
  await write(
    root,
    'packages/shared/package.json',
    json({ name: '@x/shared' }),
  );
  await write(root, 'packages/incus/package.json', json({ name: '@x/incus' }));
  await write(root, 'services/lib/package.json', json({ name: '@x/lib' }));
  await write(
    root,
    'services/app/package.json',
    json({
      name: '@x/app',
      dependencies: { '@x/shared': 'workspace:*', '@x/lib': 'workspace:*' },
    }),
  );
  await write(root, '.dockerignore', '');
  return root;
}

const installFile = (copies: string[]) =>
  [
    'FROM oven/bun AS workspace-deps',
    'COPY package.json bun.lock bunfig.toml ./',
    ...copies.map((path) => `COPY ${path} ./${dirname(path)}/`),
    'RUN bun install',
    '',
  ].join('\n');

const appCopies = [
  'packages/shared/package.json',
  'packages/incus/package.json',
  'services/app/package.json',
  'services/lib/package.json',
];

describe('dockerfile workspace manifests', () => {
  test('every root-install image copies the workspace its install resolves', () => {
    const dockerfiles = rootInstallDockerfiles(repository);
    expect(dockerfiles).toContain('services/web/Dockerfile');
    expect(dockerfiles).toContain(
      'tools/plop/templates/service/react/Dockerfile.hbs',
    );
    const findings = dockerfileWorkspaceFindings(repository);
    expect(describeFindings(findings)).toBe('');
  });

  test('the fixture passes when the install copies its whole closure', async () => {
    const root = await fixture();
    await write(root, 'services/app/Dockerfile', installFile(appCopies));
    expect(dockerfileWorkspaceFindings(root)).toEqual([]);
  });

  test('a manifest the closure needs and the install does not copy is named', async () => {
    const root = await fixture();
    await write(
      root,
      'services/app/Dockerfile',
      installFile(
        appCopies.filter((path) => path !== 'packages/incus/package.json'),
      ),
    );
    expect(describeFindings(dockerfileWorkspaceFindings(root))).toBe(
      'services/app/Dockerfile: missing manifests: packages/incus/package.json',
    );
  });

  test('a service dependency reached only transitively is required', async () => {
    const root = await fixture();
    await write(
      root,
      'services/app/Dockerfile',
      installFile(
        appCopies.filter((path) => path !== 'services/lib/package.json'),
      ),
    );
    expect(dockerfileWorkspaceFindings(root)).toEqual([
      {
        dockerfile: 'services/app/Dockerfile',
        missing: ['services/lib/package.json'],
        excluded: [],
      },
    ]);
  });

  test('a copied manifest the dockerignore excludes is named', async () => {
    const root = await fixture();
    await write(root, 'services/app/Dockerfile', installFile(appCopies));
    await write(
      root,
      'services/app/Dockerfile.dockerignore',
      [
        'packages/',
        '!packages/shared/package.json',
        'services/',
        '!services/app/package.json',
        '!services/lib/package.json',
        '',
      ].join('\n'),
    );
    expect(dockerfileWorkspaceFindings(root)).toEqual([
      {
        dockerfile: 'services/app/Dockerfile',
        missing: [],
        excluded: ['packages/incus/package.json'],
      },
    ]);
  });

  test('a dockerignore re-include brings a manifest back into the context', () => {
    const rules = ['packages/', '!packages/incus/package.json'].join('\n');
    expect(reachesContext(rules, 'packages/incus/package.json')).toBe(true);
    expect(reachesContext(rules, 'packages/shared/package.json')).toBe(false);
    expect(
      reachesContext(
        'packages/\n!packages/x/package.json',
        'packages/x/package.json',
      ),
    ).toBe(true);
  });

  test('a Dockerfile that does not install the root workspace is out of scope', async () => {
    const root = await fixture();
    await write(
      root,
      'services/app/Dockerfile',
      'FROM oven/bun\nCOPY services/app/package.json ./\n',
    );
    expect(rootInstallDockerfiles(root)).toEqual([]);
  });

  test('copies from an earlier stage and workspace-less paths are ignored', () => {
    const manifests = new Set(['packages/shared/package.json']);
    const source = [
      'COPY --from=stage /app/packages/shared/package.json /tmp/x/',
      'COPY services/sandbox-runtime/document-node/package.json ./',
      'COPY packages/shared/package.json ./packages/shared/',
    ].join('\n');
    expect(copiedManifests(source, manifests)).toEqual([
      'packages/shared/package.json',
    ]);
  });

  test('the fixture workspace lists every manifest it declares', async () => {
    const root = await fixture();
    expect(workspaceManifests(root).map((manifest) => manifest.path)).toEqual([
      'packages/incus/package.json',
      'packages/shared/package.json',
      'services/app/package.json',
      'services/lib/package.json',
    ]);
  });
});
