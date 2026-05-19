// Three-layer cleanup, per plan §1.
//
//   1. Boot sweep: kill any tale.sandbox=1 container/volume left behind.
//   2. Periodic sweep: every 5 min, kill anything older than 2× max_timeout
//      that isn't in the in-memory in-flight set.
//   3. SIGTERM handler: kill in-flight before exit.

import { isInFlight } from './spawn.ts';
import { runDocker, dockerKill, dockerRm } from './spawn_util.ts';
import type { SpawnerConfig } from './types.ts';

const PERIODIC_INTERVAL_MS = 5 * 60_000;

async function listLabeled(
  scope: 'container' | 'volume',
  label: string,
): Promise<string[]> {
  const args =
    scope === 'container'
      ? ['ps', '-aq', '-f', `label=${label}`]
      : ['volume', 'ls', '-q', '-f', `label=${label}`];
  const result = await runDocker(args);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function bootSweep(): Promise<void> {
  // Containers first; volumes after (volume rm fails on attached volumes).
  const containers = await listLabeled('container', 'tale.sandbox=1');
  for (const c of containers) {
    await dockerRm(c);
  }
  const stagingContainers = await listLabeled(
    'container',
    'tale.sandbox-staging=1',
  );
  for (const c of stagingContainers) {
    await dockerRm(c);
  }
  const volumes = await listLabeled('volume', 'tale.sandbox=1');
  for (const v of volumes) {
    await runDocker(['volume', 'rm', '--force', v]);
  }
  if (containers.length > 0 || volumes.length > 0) {
    console.log(
      `[sandbox] boot sweep removed ${containers.length} container(s) and ${volumes.length} volume(s)`,
    );
  }
}

export function startPeriodicSweep(cfg: SpawnerConfig): () => void {
  const interval = setInterval(async () => {
    try {
      // List containers with full label data so we can compare started time.
      const result = await runDocker([
        'ps',
        '-a',
        '--filter',
        'label=tale.sandbox=1',
        '--format',
        '{{.Names}}\t{{.Labels}}',
      ]);
      if (result.exitCode !== 0) return;
      const now = Date.now();
      const staleThreshold = now - 2 * cfg.maxTimeoutMs;
      for (const line of result.stdout.split('\n')) {
        const [name, labels] = line.split('\t');
        if (!name) continue;
        const m = labels?.match(/tale\.started=(\d+)/);
        if (!m) continue;
        const started = Number.parseInt(m[1] ?? '0', 10);
        if (Number.isNaN(started) || started >= staleThreshold) continue;
        // session id is the second component of the name (tale-sbx-<uuid>).
        const sessionId = name.replace(/^tale-sbx-/, '');
        if (isInFlight(sessionId)) continue;
        await dockerKill(name);
        await dockerRm(name);
        console.log(
          `[sandbox] periodic sweep killed stale container ${name} (started ${new Date(started).toISOString()})`,
        );
      }
      // Also reap orphan session volumes whose label-started is older than
      // threshold. (Workspace volume is tagged with tale.session=<uuid>.)
      const vols = await runDocker([
        'volume',
        'ls',
        '--filter',
        'label=tale.sandbox=1',
        '--format',
        '{{.Name}}',
      ]);
      for (const v of vols.stdout.split('\n')) {
        const n = v.trim();
        if (!n) continue;
        const sessionId = n.replace(/^tale-sbx-/, '');
        if (isInFlight(sessionId)) continue;
        // If the named container is gone but the volume remains, drop it.
        const exists = await runDocker(['inspect', `tale-sbx-${sessionId}`]);
        if (exists.exitCode === 0) continue;
        await runDocker(['volume', 'rm', '--force', n]);
      }
    } catch (err) {
      console.warn(`[sandbox] periodic sweep error: ${String(err)}`);
    }
  }, PERIODIC_INTERVAL_MS);
  return () => clearInterval(interval);
}

export function installSignalHandlers(getInFlight: () => string[]): void {
  const onTerm = async (sig: string) => {
    console.log(`[sandbox] received ${sig}; killing in-flight containers`);
    const ids = getInFlight();
    for (const id of ids) {
      await dockerKill(`tale-sbx-${id}`);
      await runDocker(['volume', 'rm', '--force', `tale-sbx-${id}`]);
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void onTerm('SIGTERM'));
  process.on('SIGINT', () => void onTerm('SIGINT'));
}
