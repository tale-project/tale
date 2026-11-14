/**
 * The workspace manifests that a root-install image copies must cover what
 * `bun install` resolves for it. Every image that installs the root workspace
 * (`COPY package.json bun.lock bunfig.toml ./`) copies a hand-kept list of
 * `package.json` files, and its `.dockerignore` re-includes the same files
 * past its exclusions. A workspace missing from either list breaks the image
 * only in CI: packages/incus was added without the five site Dockerfiles, four
 * dockerignores and the plop template.
 *
 * The rule: a copied list must hold every workspace that the copied manifests
 * and the `packages/*` libraries depend on, transitively through `workspace:`
 * dependencies, and every copied manifest must reach the build context past
 * the dockerignore. The guard reads the real files, so a new workspace or a
 * new dependency fails `bun run check` until the lists follow it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export interface Manifest {
  /** Repo-relative path of the workspace's package.json, e.g. `packages/ui/package.json`. */
  path: string;
  name: string;
  /** Names of every dependency that is also a workspace name. */
  workspaceDependencies: string[];
}

export interface DockerfileFinding {
  dockerfile: string;
  /** Workspace manifests the image depends on but does not copy. */
  missing: string[];
  /** Copied manifests that the dockerignore excludes without re-including them. */
  excluded: string[];
}

const ROOT_INSTALL = /^COPY package\.json bun\.lock bunfig\.toml \.\/\s*$/m;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function expandWorkspace(root: string, pattern: string): string[] {
  const normalized = pattern.replace(/\/+$/, '');
  if (!normalized.endsWith('/*')) return [normalized];
  const base = normalized.slice(0, -2);
  const directory = join(root, base);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .sort()
    .filter((entry) => statSync(join(directory, entry)).isDirectory())
    .map((entry) => posix.join(base, entry));
}

/** Every workspace of the root manifest, read from its own package.json. */
export function workspaceManifests(root: string): Manifest[] {
  const rootManifest = readJson(join(root, 'package.json'));
  const patterns = Array.isArray(rootManifest.workspaces)
    ? (rootManifest.workspaces as string[])
    : [];
  const directories = [
    ...new Set(patterns.flatMap((pattern) => expandWorkspace(root, pattern))),
  ].filter((directory) => existsSync(join(root, directory, 'package.json')));
  const read = directories.map((directory) => {
    const path = posix.join(directory, 'package.json');
    const json = readJson(join(root, path));
    const dependencies = [
      json.dependencies,
      json.devDependencies,
      json.optionalDependencies,
    ].flatMap((section) =>
      Object.keys((section as Record<string, string> | undefined) ?? {}),
    );
    return { path, name: String(json.name), dependencies };
  });
  const names = new Set(read.map((manifest) => manifest.name));
  return read.map((manifest) => ({
    path: manifest.path,
    name: manifest.name,
    workspaceDependencies: manifest.dependencies.filter((name) =>
      names.has(name),
    ),
  }));
}

/** The manifests a root-install closure needs, starting from `seeds`. */
export function requiredManifests(
  manifests: readonly Manifest[],
  seeds: readonly string[],
): string[] {
  const byPath = new Map(
    manifests.map((manifest) => [manifest.path, manifest]),
  );
  const byName = new Map(
    manifests.map((manifest) => [manifest.name, manifest]),
  );
  const required = new Set<string>();
  const pending = [...seeds];
  while (pending.length > 0) {
    const path = pending.pop() as string;
    if (required.has(path)) continue;
    required.add(path);
    const manifest = byPath.get(path);
    if (!manifest) continue;
    for (const name of manifest.workspaceDependencies) {
      const dependency = byName.get(name);
      if (dependency) pending.push(dependency.path);
    }
  }
  return [...required].sort();
}

/** Manifests a Dockerfile copies from the build context (`COPY` without `--from`). */
export function copiedManifests(
  source: string,
  manifests: ReadonlySet<string>,
): string[] {
  const copied = new Set<string>();
  for (const line of source.split('\n')) {
    const match = /^\s*COPY\s+(.*)$/.exec(line);
    if (!match || /--from=/.test(match[1] ?? '')) continue;
    const words = (match[1] ?? '')
      .trim()
      .split(/\s+/)
      .filter((word) => !word.startsWith('--'));
    for (const word of words.slice(0, -1)) {
      const path = posix.normalize(word.replace(/^\.\//, ''));
      if (manifests.has(path)) copied.add(path);
    }
  }
  return [...copied].sort();
}

/** Whether a dockerignore's rules leave `path` in the build context. */
export function reachesContext(dockerignore: string, path: string): boolean {
  let included = true;
  for (const raw of dockerignore.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    const pattern = (negated ? line.slice(1) : line)
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .replace(/\/+$/, '');
    if (pattern.includes('*')) continue;
    if (path === pattern || path.startsWith(`${pattern}/`)) {
      included = negated;
    }
  }
  return included;
}

/** The Dockerfiles that install the root workspace, with their dockerignore. */
export function rootInstallDockerfiles(root: string): string[] {
  const entries = (directory: string) =>
    existsSync(join(root, directory)) ? readdirSync(join(root, directory)) : [];
  const candidates = [
    ...entries('services').map((service) =>
      posix.join('services', service, 'Dockerfile'),
    ),
    ...entries('tools/plop/templates/service').map((kind) =>
      posix.join('tools/plop/templates/service', kind, 'Dockerfile.hbs'),
    ),
  ];
  return candidates
    .filter((file) => existsSync(join(root, file)))
    .filter((file) => ROOT_INSTALL.test(readFileSync(join(root, file), 'utf8')))
    .sort();
}

function dockerignoreFor(root: string, dockerfile: string): string {
  const directory = posix.dirname(dockerfile);
  for (const name of [
    'Dockerfile.dockerignore',
    'Dockerfile.dockerignore.hbs',
  ]) {
    const file = join(root, directory, name);
    if (existsSync(file)) return readFileSync(file, 'utf8');
  }
  return readFileSync(join(root, '.dockerignore'), 'utf8');
}

/** Each root-install Dockerfile whose manifest lists fall short of the workspace. */
export function dockerfileWorkspaceFindings(root: string): DockerfileFinding[] {
  const manifests = workspaceManifests(root);
  const known = new Set(manifests.map((manifest) => manifest.path));
  const packages = manifests
    .map((manifest) => manifest.path)
    .filter((path) => path.startsWith('packages/'));
  const findings: DockerfileFinding[] = [];
  for (const dockerfile of rootInstallDockerfiles(root)) {
    const source = readFileSync(join(root, dockerfile), 'utf8');
    const copied = copiedManifests(source, known);
    const required = requiredManifests(manifests, [...copied, ...packages]);
    const ignore = dockerignoreFor(root, dockerfile);
    findings.push({
      dockerfile,
      missing: required.filter((path) => !copied.includes(path)),
      excluded: copied.filter((path) => !reachesContext(ignore, path)),
    });
  }
  return findings.filter(
    (finding) => finding.missing.length > 0 || finding.excluded.length > 0,
  );
}

export function describeFindings(
  findings: readonly DockerfileFinding[],
): string {
  return findings
    .map((finding) => {
      const parts: string[] = [];
      if (finding.missing.length > 0)
        parts.push(`missing manifests: ${finding.missing.join(', ')}`);
      if (finding.excluded.length > 0)
        parts.push(
          `excluded by its dockerignore: ${finding.excluded.join(', ')}`,
        );
      return `${finding.dockerfile}: ${parts.join('; ')}`;
    })
    .join('\n');
}
