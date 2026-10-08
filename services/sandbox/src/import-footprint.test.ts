// What a Docker spawner (and every connected device, which runs the same
// entrypoint) loads at boot. The Kubernetes API client and the error-reporting
// SDK are each worth tens of MiB resident and a few hundred milliseconds of
// import; neither is needed unless SANDBOX_BACKEND=kubernetes or SENTRY_DSN
// asks for it, so neither may be reachable from server.ts through a static
// import. The check runs the real entrypoint in a child process and reads the
// module registry, so a transitive or package-level import counts too.

import { expect, test } from 'bun:test';

const source = import.meta.dir;

const HEAVY = ['/@kubernetes/client-node/', '/@sentry/'];

async function loadedHeavyModules(
  env: Record<string, string>,
  afterBoot = '',
): Promise<{ boot: string[]; after: string[] }> {
  const script = `
    const heavy = ${JSON.stringify(HEAVY)};
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
