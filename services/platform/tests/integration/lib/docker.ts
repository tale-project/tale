/**
 * Docker + Docker Compose helpers shared by the container tests. Wraps the
 * `docker compose -f … -p …` invocations and the `docker inspect` probes the
 * bash suites built up with string interpolation.
 */
import { capture, ok, stdoutOf, stream, type RunOptions } from './exec';

/** Builds the repeated `docker compose -f … -p …` argv prefix. */
export function composeArgs(opts: {
  files: string[];
  envFile?: string;
  project: string;
}): string[] {
  const args = ['docker', 'compose'];
  for (const f of opts.files) args.push('-f', f);
  if (opts.envFile) args.push('--env-file', opts.envFile);
  args.push('-p', opts.project);
  return args;
}

/** A bound compose command for one project — the bash `COMPOSE_CMD` variable. */
export class Compose {
  constructor(
    private readonly prefix: string[],
    private readonly cwd: string,
  ) {}

  private args(extra: string[]): string[] {
    return [...this.prefix, ...extra];
  }

  /** Run a compose subcommand, streaming output. Returns the exit code. */
  run(extra: string[], opts: RunOptions = {}): Promise<number> {
    return stream(this.args(extra), { cwd: this.cwd, ...opts });
  }

  /** Run a compose subcommand, capturing output. */
  capture(extra: string[], opts: RunOptions = {}) {
    return capture(this.args(extra), { cwd: this.cwd, ...opts });
  }

  /** `docker compose … config --images` → list of resolved image refs. */
  async images(): Promise<string[]> {
    const out = await stdoutOf(this.args(['config', '--images']), {
      cwd: this.cwd,
    });
    return out ? out.split('\n').filter(Boolean) : [];
  }

  /** First resolved image whose ref contains `/tale-<service>:` (anchored). */
  async imageFor(service: string): Promise<string> {
    const imgs = await this.images();
    return imgs.find((i) => i.includes(`/tale-${service}:`)) ?? '';
  }

  /** First resolved image (`config --images | head -1`), or ''. */
  async imageHead(): Promise<string> {
    const imgs = await this.images();
    return imgs[0] ?? '';
  }

  /** Container id for a service (`compose ps -q <svc>`), or ''. */
  async containerId(service: string): Promise<string> {
    const out = await stdoutOf(this.args(['ps', '-q', service]), {
      cwd: this.cwd,
    });
    return out.split('\n')[0] ?? '';
  }

  /**
   * Resolved container name for a service, falling back to the conventional
   * `tale-<service>` name when compose can't resolve an id.
   */
  async containerName(service: string): Promise<string> {
    const cid = await this.containerId(service);
    if (!cid) return `tale-${service}`;
    const name = await dockerInspect(cid, '{{.Name}}');
    return name ? name.replace(/^\//, '') : `tale-${service}`;
  }

  down(): Promise<number> {
    return this.run(['down', '-v', '--remove-orphans']);
  }
}

/** `docker inspect --format=<fmt> <ref>` → trimmed stdout, or '' on failure. */
export function dockerInspect(ref: string, format: string): Promise<string> {
  return stdoutOf(['docker', 'inspect', `--format=${format}`, ref]);
}

/** Image size in MiB (`{{.Size}}` / 1024 / 1024), or 0 when unknown. */
export async function imageSizeMb(ref: string): Promise<number> {
  const bytes = await dockerInspect(ref, '{{.Size}}');
  const n = Number.parseInt(bytes, 10);
  return Number.isFinite(n) ? Math.floor(n / 1024 / 1024) : 0;
}

/**
 * Health status of a container, mirroring the bash `{{if .State.Health}}…`
 * probe. Returns one of `healthy` / `unhealthy` / `no_healthcheck` /
 * `not_found`, or a transient docker status string.
 */
export async function healthStatus(containerName: string): Promise<string> {
  const out = await dockerInspect(
    containerName,
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}no_healthcheck{{end}}',
  );
  return out || 'not_found';
}

/** Run-state of a container (`{{.State.Status}}`), or 'missing'. */
export async function containerState(containerName: string): Promise<string> {
  const out = await dockerInspect(containerName, '{{.State.Status}}');
  return out || 'missing';
}

/** `docker exec <container> <cmd…>` exits 0. */
export function dockerExecOk(
  container: string,
  cmd: string[],
): Promise<boolean> {
  return ok(['docker', 'exec', container, ...cmd]);
}

/** Curl an URL and return the HTTP status code as a string ("000" on failure). */
export async function httpStatus(
  url: string,
  maxTimeSec = 10,
): Promise<string> {
  const { stdout, exitCode } = await capture([
    'curl',
    '-s',
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    '--max-time',
    String(maxTimeSec),
    url,
  ]);
  const code = stdout.trim();
  return exitCode === 0 && code ? code : '000';
}

/** Human-readable image size (`docker images --format '{{.Size}}' <ref>`), or 'N/A'. */
export async function imageSizeHuman(ref: string): Promise<string> {
  const out = await stdoutOf([
    'docker',
    'images',
    '--format',
    '{{.Size}}',
    ref,
  ]);
  return out.split('\n')[0] || 'N/A';
}

/** Image refs from `docker images` whose `repo:tag` contains the needle. */
export async function dockerImagesMatching(needle: string): Promise<string[]> {
  const out = await stdoutOf([
    'docker',
    'images',
    '--format',
    '{{.Repository}}:{{.Tag}}',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .filter((i) => i.includes(needle));
}

/** `docker image inspect <ref>` exits 0 (image exists locally). */
export function imageExists(ref: string): Promise<boolean> {
  return ok(['docker', 'image', 'inspect', ref]);
}

/** Remove a network, ignoring "not found"; then create it with the given flags. */
export async function recreateNetwork(
  name: string,
  flags: string[],
): Promise<void> {
  await ok(['docker', 'network', 'rm', name]);
  await capture(['docker', 'network', 'create', ...flags, name]);
}

export const removeNetwork = (name: string): Promise<boolean> =>
  ok(['docker', 'network', 'rm', name]);

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Current epoch seconds — the bash `$(date +%s)` used for elapsed timing. */
export const nowSec = (): number => Math.floor(Date.now() / 1000);
