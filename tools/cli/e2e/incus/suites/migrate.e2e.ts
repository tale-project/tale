// migrate (design 14, R-16, R3-13, R3-27): a workspace deployed on Docker
// Compose, on the same host with Docker still installed, moved to Incus by
// `tale runtime migrate --to incus`. Docker's FORWARD drop policy is met with
// the `DOCKER-USER` remedy bootstrap names (applied here as the operator
// would, by hand); the migration stops Docker's edge before the Incus edge's
// proxy devices exist; the row written on Docker is read back on Incus; and
// after a restart of dockerd Docker's `proxy` stays stopped while the Incus
// edge serves.
//
// It needs Docker with its compose plugin, the host's ports 80 and 443 free
// for the Docker edge, and root for the firewall: it runs where the lab is
// the run's own (the CI workflow's runner). The dockerd restart restarts
// every container on the host, so it runs only with
// TALE_E2E_RESTART_DOCKERD=1.

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expectCode, incus, record, until } from '../harness';
import {
  instanceOf,
  loadWorkspace,
  markers,
  releaseClis,
  setEnv,
  tale,
  viaEdge,
  type WorkspaceLab,
} from '../workspace';

setDefaultTimeout(2 * 60 * 60_000);
const w = loadWorkspace();

/** The migrated workspace: a Docker workspace whose `runtime.next` declares
 * an Incus stack of its own (`<name>-mg`). */
const mg: WorkspaceLab = {
  ...w,
  name: (
    process.env.TALE_E2E_MG_NAME ?? `${w.lab.name.slice(0, 11)}-mg`
  ).trim(),
  network: {
    subnet: process.env.TALE_E2E_MG_SUBNET ?? '10.24.0.0/22',
    gateway: process.env.TALE_E2E_MG_GATEWAY ?? '10.24.0.1',
    block: process.env.TALE_E2E_MG_BLOCK ?? '10.24.1.0/24',
  },
  sessions: process.env.TALE_E2E_MG_SESSIONS ?? '10.25.0.0/24',
};
mg.dir = join(w.lab.dir, 'workspace', mg.name);

function sh(argv: readonly string[]): {
  code: number;
  stdout: string;
  stderr: string;
} {
  const [command, ...rest] = argv;
  const result = spawnSync(command ?? 'true', rest, {
    encoding: 'utf8',
    timeout: 10 * 60_000,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Why the host cannot hold this suite, or null. */
function unfit(): string | null {
  if (sh(['docker', 'compose', 'version']).code !== 0)
    return 'no Docker compose plugin';
  const held = sh([
    'ss',
    '-ltnH',
    '( sport = :80 or sport = :443 )',
  ]).stdout.trim();
  if (held !== '') return `ports 80/443 are held on the host:\n${held}`;
  return null;
}
const reason = process.env.TALE_E2E_LAB === '1' ? unfit() : 'no lab';
if (reason !== null) console.warn(`migrate: skipped: ${reason}`);

/** The firewall rules this suite applied, removed at the end. */
const applied: string[][] = [];
afterAll(() => {
  for (const rule of applied) sh([...w.lab.root, 'iptables', '-D', ...rule]);
});

/** The Docker stack's containers of the workspace, by compose service. */
function dockerContainers(
  projectId: string,
): Record<string, { name: string; running: boolean; finishedAt: string }> {
  const listed = sh([
    'docker',
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${projectId}`,
    '--format',
    '{{.Names}}\t{{.Label "com.docker.compose.service"}}',
  ]).stdout.trim();
  const out: Record<
    string,
    { name: string; running: boolean; finishedAt: string }
  > = {};
  for (const line of listed === '' ? [] : listed.split('\n')) {
    const [name = '', service = ''] = line.split('\t');
    const state = JSON.parse(
      sh(['docker', 'inspect', '--format', '{{json .State}}', name]).stdout ||
        '{}',
    ) as { Running?: boolean; FinishedAt?: string };
    out[service] = {
      name,
      running: state.Running === true,
      finishedAt: state.FinishedAt ?? '',
    };
  }
  return out;
}

/** SQL in the Docker stack's database. */
function dockerSql(container: string, statement: string): string {
  const out = sh([
    'docker',
    'exec',
    container,
    'sh',
    '-c',
    `psql -v ON_ERROR_STOP=1 -At -U "\${POSTGRES_USER:-tale}" -d "\${APP_DB_NAME:-tale_app}" -c "$1"`,
    'sql',
    statement,
  ]);
  if (out.code !== 0) throw new Error(`psql in ${container}: ${out.stderr}`);
  return out.stdout.trim();
}

describe('migrate', () => {
  test.skipIf(reason !== null)(
    'a Docker deploy on the same host moves to Incus; Docker’s edge stays stopped across a dockerd restart',
    async () => {
      await releaseClis(w);
      // A Docker workspace that declares where it goes.
      expectCode(tale(mg, ['init', mg.dir, '--yes']), 0);
      const declaration = join(mg.dir, 'tale.json');
      const project = JSON.parse(readFileSync(declaration, 'utf8')) as {
        id: string;
        runtime?: unknown;
      };
      project.runtime = {
        engine: 'docker',
        next: {
          engine: 'incus',
          incus: {
            endpoint: w.lab.endpoint,
            project: mg.name,
            pool: w.lab.pool,
            network: { name: mg.name, ...mg.network },
            sessions: { subnet: mg.sessions },
            ingress: { mode: 'proxy-device' },
            ...(w.lab.dockerMirror === ''
              ? {}
              : { registryMirror: w.lab.dockerMirror }),
            registryMirrors: { 'ghcr.io': w.lab.registry },
          },
        },
      };
      writeFileSync(declaration, `${JSON.stringify(project, null, 2)}\n`);
      // Docker reads the lab's registry directly (loopback registries are
      // plain HTTP to dockerd).
      setEnv(mg, {
        GHCR_REGISTRY: `${w.lab.registry}/tale-project/tale`,
        HOST: 'localhost',
        SITE_URL: 'http://localhost',
        TLS_MODE: 'external',
      });
      // The third-party sidecar, through the lab's Docker Hub mirror.
      if (w.lab.dockerMirror !== '') {
        const image = 'brainicism/bgutil-ytdlp-pot-provider:1.3.1';
        const mirrored = `${w.lab.dockerMirror.replace(/:443$/, '')}/${image}`;
        if (sh(['docker', 'image', 'inspect', image]).code !== 0) {
          expect(sh(['docker', 'pull', '-q', mirrored]).code).toBe(0);
          expect(sh(['docker', 'tag', mirrored, image]).code).toBe(0);
        }
      }

      // Incus made ready for runtime.next; the firewall rules it names are
      // the operator's to apply.
      const bootstrap = expectCode(
        tale(mg, ['incus', 'bootstrap', '--workspace', mg.dir, '--yes'], {
          prefix: w.lab.root,
        }),
        0,
      );
      const rules = [
        ...(bootstrap.stdout + bootstrap.stderr).matchAll(
          /firewall iptables (DOCKER-USER .+)$/gm,
        ),
      ].map((match) => (match[1] ?? '').trim().split(/\s+/));
      for (const rule of rules) {
        expect(sh([...w.lab.root, 'iptables', '-I', ...rule]).code).toBe(0);
        applied.push(rule);
      }
      const check = expectCode(tale(mg, ['incus', 'check']), 0);

      // Release N on Docker, and a row in its database.
      expectCode(tale(mg, ['deploy', '--yes', '--skip-backup']), 0);
      const docker = dockerContainers(project.id);
      const db = docker.db?.name ?? '';
      expect(db).not.toBe('');
      dockerSql(
        db,
        "CREATE TABLE IF NOT EXISTS e2e_marker (label text PRIMARY KEY, written timestamptz NOT NULL DEFAULT now()); INSERT INTO e2e_marker (label) VALUES ('migrated') ON CONFLICT DO NOTHING",
      );

      const migrated = expectCode(
        tale(mg, ['runtime', 'migrate', '--to', 'incus'], {
          timeoutMs: 90 * 60_000,
        }),
        0,
      );
      const after = dockerContainers(project.id);
      const edge = instanceOf(mg, 'proxy');
      const edgeCreated = Date.parse(
        (
          JSON.parse(
            incus(w.lab, [
              'query',
              `/1.0/instances/${edge.name}?project=${mg.name}`,
            ]).stdout,
          ) as { created_at: string }
        ).created_at,
      );
      const dockerEdgeStopped = Date.parse(after.proxy?.finishedAt ?? '');
      const held = markers(mg);
      const engine = (
        JSON.parse(readFileSync(declaration, 'utf8')) as {
          runtime: { engine: string };
        }
      ).runtime.engine;
      const devices = Object.keys(
        (
          JSON.parse(
            incus(w.lab, [
              'query',
              `/1.0/instances/${edge.name}?project=${mg.name}`,
            ]).stdout,
          ) as { devices: Record<string, unknown> }
        ).devices,
      ).filter((name) => name.startsWith('ingress-'));

      // dockerd restarted: Docker's edge stays stopped, the Incus edge serves.
      let restart: Record<string, unknown> = {
        skipped: 'TALE_E2E_RESTART_DOCKERD is not 1',
      };
      if (process.env.TALE_E2E_RESTART_DOCKERD === '1') {
        expect(sh([...w.lab.root, 'systemctl', 'restart', 'docker']).code).toBe(
          0,
        );
        await until(
          'dockerd to answer',
          () => sh(['docker', 'info', '--format', '{{.ID}}']).code === 0,
          {
            timeoutMs: 5 * 60_000,
            intervalMs: 2_000,
          },
        );
        await Bun.sleep(10_000);
        const target = viaEdge(mg, '/api/health', edge.address ?? '');
        const response = await fetch(target.url, {
          headers: { ...target.headers, Host: 'localhost' },
        });
        restart = {
          dockerEdgeRunning:
            dockerContainers(project.id).proxy?.running ?? null,
          anyRunning: Object.values(dockerContainers(project.id))
            .filter((c) => c.running)
            .map((c) => c.name),
          incusEdge: response.status,
        };
      }

      record(w.lab, 'migrate', {
        firewall: rules.map((rule) => rule.join(' ')),
        check: (check.stdout + check.stderr).slice(-600),
        migrateMs: migrated.ms,
        dockerAfter: after,
        edgeCreated: new Date(edgeCreated).toISOString(),
        dockerEdgeStopped: after.proxy?.finishedAt,
        ingressDevices: devices,
        markers: held,
        engine,
        restart,
      });

      expect(
        Object.values(after).every((container) => !container.running),
      ).toBe(true);
      expect(dockerEdgeStopped).toBeLessThan(edgeCreated);
      expect(devices.length).toBeGreaterThan(0);
      expect(held).toContain('migrated');
      expect(engine).toBe('incus');
      if (process.env.TALE_E2E_RESTART_DOCKERD === '1') {
        expect(restart.dockerEdgeRunning).toBe(false);
        expect(restart.anyRunning).toEqual([]);
        expect(restart.incusEdge).toBe(200);
      }
    },
  );
});
