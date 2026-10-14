// What a Docker spawner (and every connected device, which runs the same
// entrypoint) loads at boot. The Kubernetes API client and the error-reporting
// SDK are each worth tens of MiB resident and a few hundred milliseconds of
// import; neither is needed unless SANDBOX_BACKEND=kubernetes or SENTRY_DSN
// asks for it, so neither may be reachable from server.ts through a static
// import. The Incus backend is no heavier than its fetch, but the same rule
// holds: a spawner that does not run on Incus does not load it. The check
// runs the real entrypoint in a child process and reads the module registry,
// so a transitive or package-level import counts too.

import { expect, test } from 'bun:test';

const source = import.meta.dir;

const HEAVY = ['/@kubernetes/client-node/', '/@sentry/'];
/** The Incus backend's runtime: what talks to the node. (Its settings reader
 * is plain code the config loads whatever the backend.) */
const INCUS = [
  '/backend/incus/incus-backend.ts',
  '/backend/incus/incus-client.ts',
  '/backend/incus/incus-pool.ts',
  '/backend/incus/incus-session-backend.ts',
];

async function loadedHeavyModules(
  env: Record<string, string>,
  afterBoot = '',
  markers: readonly string[] = HEAVY,
): Promise<{ boot: string[]; after: string[] }> {
  const script = `
    const heavy = ${JSON.stringify(markers)};
    const loaded = () => [...new Set(Object.keys(require.cache).flatMap((path) => heavy.filter((name) => path.includes(name))))].sort();
    await import(${JSON.stringify(`${source}/server.ts`)});
    const boot = loaded();
    ${afterBoot}
    console.log(JSON.stringify({ boot, after: loaded() }));
  `;
  const child = Bun.spawn([process.execPath, '-e', script], {
    env: {
      // The test runner's own sandbox and reporting settings stay out.
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => !/^(SANDBOX_|SENTRY_)/.test(name),
        ),
      ),
      SANDBOX_TOKEN: 'import-footprint-test',
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ exit, stderr }).toEqual({ exit: 0, stderr: '' });
  return JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}');
}

test('a Docker spawner never loads the Kubernetes client or the error-reporting SDK', async () => {
  const { boot, after } = await loadedHeavyModules(
    { SANDBOX_BACKEND: 'docker' },
    // The registry does list them once something imports them: the check
    // above would see a regression.
    `await import(${JSON.stringify(`${source}/backend/kubernetes/k8s-client.ts`)});
     await import('@sentry/bun');`,
  );
  expect(boot).toEqual([]);
  expect(after).toEqual(HEAVY);
}, 30_000);

test('the Kubernetes backend loads its client when it is the one selected', async () => {
  const { boot } = await loadedHeavyModules({
    SANDBOX_BACKEND: 'kubernetes',
    // Never reach a real cluster: an explicit, unreachable API server.
    SANDBOX_K8S_SERVER: 'https://127.0.0.1:9',
    SANDBOX_K8S_TOKEN: 'import-footprint-test',
  });
  expect(boot).toEqual(['/@kubernetes/client-node/']);
}, 30_000);

test('a Docker spawner never loads the Incus backend', async () => {
  const { boot, after } = await loadedHeavyModules(
    { SANDBOX_BACKEND: 'docker' },
    `await import(${JSON.stringify(`${source}/backend/incus/incus-backend.ts`)});
     await import(${JSON.stringify(`${source}/backend/incus/incus-session-backend.ts`)});`,
    INCUS,
  );
  expect(boot).toEqual([]);
  expect(after).toEqual(INCUS);
}, 30_000);

test('the Incus backend loads when it is the one selected, and not the Kubernetes client', async () => {
  const env = {
    SANDBOX_BACKEND: 'incus',
    SANDBOX_INCUS_ENDPOINT: 'https://127.0.0.1:9',
    SANDBOX_INCUS_PROJECT: 'import-footprint-test',
    SANDBOX_INCUS_PROFILE: 'sandbox',
    SANDBOX_INCUS_NETWORK: 'sbx0',
    SANDBOX_INCUS_STORAGE_POOL: 'tank',
    SANDBOX_INCUS_IMAGE: 'tale-sandbox-runtime',
    SANDBOX_INCUS_CLIENT_CERT_FILE: '/nonexistent/client.crt',
    SANDBOX_INCUS_CLIENT_KEY_FILE: '/nonexistent/client.key',
    SANDBOX_INCUS_SERVER_CERT_FILE: '/nonexistent/server.crt',
    SANDBOX_EGRESS_PROXY: 'http://127.0.0.1:3128',
    SANDBOX_MAX_SESSIONS: '8',
  };
  const { boot } = await loadedHeavyModules(env, '', INCUS);
  expect(boot).toEqual(INCUS);
  const { boot: heavy } = await loadedHeavyModules(env);
  expect(heavy).toEqual([]);
}, 60_000);
