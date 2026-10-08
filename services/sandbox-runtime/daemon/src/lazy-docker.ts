/** Root supervisor for automatic Docker socket activation; runnerd stays uid 10001. */
import { spawn } from 'node:child_process';
import {
  chmod,
  chown,
  lstat,
  mkdir,
  readFile,
  readdir,
  unlink,
} from 'node:fs/promises';
import { createServer as createHttpServer, request } from 'node:http';
import { createConnection, createServer, type Socket } from 'node:net';

import {
  DOCKER_RECOVERY_HEADER,
  InnerDockerHealth,
  LAZY_DOCKER_HEALTH_SOCKET,
} from './inner-docker-health.ts';

export interface EngineHandle {
  exited: Promise<void>;
  stop(): Promise<void>;
}
interface ProxyOptions {
  publicSocket: string;
  privateSocket: string;
  healthSocket?: string;
  startEngine(signal: AbortSignal): Promise<EngineHandle>;
  canStop(): Promise<boolean>;
  idleMs?: number;
  retryIdleMs?: number;
  maxClients?: number;
}

/** Paused sockets and pipe() keep buffering bounded and preserve hijacked Docker streams. */
export async function createLazyDockerProxy(options: ProxyOptions) {
  const clients = new Set<Socket>();
  const upstreams = new Map<Socket, Socket>();
  const idleMs = options.idleMs ?? 5 * 60_000;
  let engine: EngineHandle | undefined;
  let starting: Promise<EngineHandle> | undefined;
  let stopping: Promise<void> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let epoch = 0;
  let closed = false;
  let failed = false;
  const abort = new AbortController();
  let closePromise: Promise<void> | undefined;
  let engineHealth: InnerDockerHealth | undefined;

  async function health(): Promise<{
    dockerReady: boolean;
    dockerRecoveryRequired: boolean;
  }> {
    const available = { dockerReady: true, dockerRecoveryRequired: false };
    const unavailable = { dockerReady: false, dockerRecoveryRequired: true };
    // A failed start has completed its cleanup; an unexpected exit is an
    // observed process termination. Neither relies on uncertain ping timing.
    if (closed || failed) return unavailable;
    const candidate = engine;
    // A cold or intentionally stopped engine remains available on demand.
    // Health must never join activation clients or extend their idle timer.
    if (!candidate) return available;
    const reading = await engineHealth?.snapshot();
    // An intentional stop may race the ping; an unexpected exit sets failed.
    if (closed || failed) return unavailable;
    if (engine !== candidate) return available;
    return {
      dockerReady: reading?.dockerReady === true,
      dockerRecoveryRequired: reading?.dockerRecoveryRequired === true,
    };
  }

  function scheduleIdle(delay = idleMs) {
    clearTimeout(idleTimer);
    if (closed || clients.size || !engine || stopping) return;
    idleTimer = setTimeout(() => {
      void checkIdle();
    }, delay);
    idleTimer.unref();
  }
  async function checkIdle() {
    const candidate = engine;
    const checkEpoch = epoch;
    if (!candidate || clients.size || closed || stopping) return;
    let idle = false;
    try {
      idle = await options.canStop();
    } catch {
      /* Unknown state keeps Docker running. */
    }
    if (closed || clients.size || epoch !== checkEpoch || engine !== candidate)
      return;
    if (!idle) {
      scheduleIdle(options.retryIdleMs ?? 30_000);
      return;
    }
    // Set the barrier synchronously before awaiting: new clients queue behind shutdown.
    engine = undefined;
    stopping = candidate.stop();
    try {
      await stopping;
    } finally {
      stopping = undefined;
    }
  }
  async function ensureReady(): Promise<EngineHandle> {
    if (stopping) await stopping;
    if (closed) throw new Error('Docker proxy closed');
    if (engine) return engine;
    if (!starting) {
      starting = options
        .startEngine(abort.signal)
        .then(async (started) => {
          if (closed) {
            await started.stop();
            throw new Error('Docker proxy closed');
          }
          // In-flight probes belong to this engine incarnation only. A new
          // engine must not join an old engine's coalesced socket request.
          engineHealth = new InnerDockerHealth(true, {
            socketPath: options.privateSocket,
            cacheMs: 0,
            // Leave room within runnerd's 750ms supervisor probe deadline.
            timeoutMs: 500,
          });
          engine = started;
          failed = false;
          void started.exited.then(() => {
            if (engine !== started) return;
            engine = undefined;
            failed = true;
            for (const [client, upstream] of upstreams) {
              upstream.destroy();
              client.destroy();
            }
            return;
          });
          scheduleIdle();
          return started;
        })
        .catch((error: unknown) => {
          failed = true;
          throw error;
        })
        .finally(() => {
          starting = undefined;
        });
    }
    return starting;
  }
  const server = createServer({ allowHalfOpen: true }, (client) => {
    client.on('error', () => {
      client.destroy();
    });
    if (closed || clients.size >= (options.maxClients ?? 128)) {
      client.destroy();
      return;
    }
    client.pause();
    clients.add(client);
    epoch++;
    clearTimeout(idleTimer);
    client.on('close', () => {
      clients.delete(client);
      upstreams.get(client)?.destroy();
      upstreams.delete(client);
      epoch++;
      scheduleIdle();
    });
    void ensureReady()
      .then(() => {
        if (closed || client.destroyed) return;
        const upstream = createConnection({
          path: options.privateSocket,
          allowHalfOpen: true,
        });
        upstreams.set(client, upstream);
        upstream.on('error', () => {
          client.destroy();
          upstream.destroy();
        });
        upstream.on('close', () => {
          // pipe() has queued the final bytes before EOF. Destroying immediately
          // drops them for a slow reader; normal FIN must flush the writable side.
          if (!upstream.readableEnded) client.destroy();
          else if (client.writableFinished) client.destroy();
          else client.once('finish', () => client.destroy());
        });
        upstream.once('connect', () => {
          if (client.destroyed) {
            upstream.destroy();
            return;
          }
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
        });
        return;
      })
      .catch(() => {
        client.destroy();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.publicSocket, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const healthServer = options.healthSocket
    ? createHttpServer(
        {
          headersTimeout: 1_000,
          requestTimeout: 1_000,
          keepAliveTimeout: 1_000,
          connectionsCheckingInterval: 1_000,
        },
        (req, res) => {
          res.setHeader('connection', 'close');
          if (req.method !== 'GET' || req.url !== '/_ping') {
            res.writeHead(404).end();
            return;
          }
          void health().then((reading) => {
            res.setHeader(
              DOCKER_RECOVERY_HEADER,
              String(reading.dockerRecoveryRequired),
            );
            res
              .writeHead(reading.dockerReady ? 200 : 503)
              .end(reading.dockerReady ? 'OK' : 'unavailable');
            return;
          });
        },
      )
    : undefined;
  if (healthServer) {
    healthServer.maxConnections = 16;
    healthServer.maxRequestsPerSocket = 1;
    healthServer.on('connection', (socket) => {
      socket.setTimeout(1_000, () => socket.destroy());
    });
    try {
      await new Promise<void>((resolve, reject) => {
        healthServer.once('error', reject);
        healthServer.listen(options.healthSocket, () => {
          healthServer.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      throw error;
    }
  }
  return {
    ensureReady,
    close() {
      if (closePromise) return closePromise;
      closed = true;
      clearTimeout(idleTimer);
      abort.abort();
      for (const client of clients) client.destroy();
      closePromise = (async () => {
        const listenerClosed = Promise.all([
          new Promise<void>((resolve) => server.close(() => resolve())),
          new Promise<void>((resolve) => {
            if (!healthServer) return resolve();
            healthServer.closeAllConnections();
            healthServer.close(() => resolve());
          }),
        ]);
        if (starting) await starting.catch(() => {});
        if (stopping) await stopping;
        if (engine) {
          const last = engine;
          engine = undefined;
          await last.stop();
        }
        await listenerClosed;
      })();
      return closePromise;
    },
  };
}

function readEngineJson(
  socketPath: string,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath, path, agent: false, signal },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(new Error('Docker inventory unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            response.destroy(new Error('Docker inventory too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()) as unknown);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error('Docker inventory timed out')),
      2000,
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('error', reject);
    req.end();
  });
}
export async function engineIsIdle(socketPath: string): Promise<boolean> {
  const signal = AbortSignal.timeout(5000);
  const version = await readEngineJson(socketPath, '/version', signal);
  if (
    !version ||
    typeof version !== 'object' ||
    !('ApiVersion' in version) ||
    typeof version.ApiVersion !== 'string' ||
    !/^\d+\.\d+$/.test(version.ApiVersion)
  )
    return false;
  const containers = await readEngineJson(
    socketPath,
    `/v${version.ApiVersion}/containers/json?all=true`,
    signal,
  );
  if (!Array.isArray(containers) || containers.length > 128) return false;
  for (const container of containers as unknown[]) {
    if (
      container === null ||
      typeof container !== 'object' ||
      !('State' in container) ||
      typeof container.State !== 'string' ||
      !['created', 'exited', 'dead'].includes(container.State) ||
      !('Id' in container) ||
      typeof container.Id !== 'string' ||
      !/^[a-f0-9]{64}$/.test(container.Id)
    )
      return false;
    const inspect = await readEngineJson(
      socketPath,
      `/v${version.ApiVersion}/containers/${container.Id}/json`,
      signal,
    );
    // Even a manually stopped restart:always container starts after an engine
    // restart. Keeping its engine alive preserves the user's stopped state.
    if (
      !inspect ||
      typeof inspect !== 'object' ||
      !('HostConfig' in inspect) ||
      !inspect.HostConfig ||
      typeof inspect.HostConfig !== 'object' ||
      !('RestartPolicy' in inspect.HostConfig) ||
      !inspect.HostConfig.RestartPolicy ||
      typeof inspect.HostConfig.RestartPolicy !== 'object' ||
      !('Name' in inspect.HostConfig.RestartPolicy) ||
      inspect.HostConfig.RestartPolicy.Name !== 'no'
    )
      return false;
  }
  return true;
}

const PUBLIC_SOCKET = '/var/run/docker.sock';
const PRIVATE_SOCKET = '/var/run/tale-docker/engine.sock';
const ENTRYPOINT = '/entrypoint.sh';
const NODE = '/opt/node/bin/node';
const ROOT_PATH = '/opt/node/bin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

/** No workspace executable, loader hook, Docker context or mutable client config runs as root. */
function engineEnvironment(boot: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: ROOT_PATH,
    HOME: '/root',
    TMPDIR: '/tmp',
    DOCKER_CONFIG: '/root/.docker',
  };
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'TALE_RUNTIME_TIER',
    'TALE_DIND_INNER_POOL_OVERRIDE',
    'TALE_BUILDKIT_NETWORK_SUBNETS',
    'TALE_BUILDKITD_ENDPOINT',
    'TALE_GATEWAY_URL',
    'TALE_TRANSPARENT_EGRESS',
  ])
    if (boot[key] !== undefined) env[key] = boot[key];
  env.TALE_LAZY_REDSOCKS_STARTED = boot.TALE_REDSOCKS_STARTED ?? '';
  env.TALE_LAZY_INNER_POOL = boot.TALE_DIND_INNER_POOL ?? '';
  env.TALE_LAZY_INNER_BIP = boot.TALE_DIND_INNER_BIP ?? '';
  return env;
}

/** runnerd's environment: the boot environment with the Node settings the
 * entrypoint withheld from this root process handed back. The agent uid can
 * write both the dependency path and the compile cache, so only runnerd (and
 * the execs it starts at that uid) may load from them. */
export function runnerEnvironment(boot: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...boot,
    NODE_PATH: boot.TALE_RUNNER_NODE_PATH ?? '',
  };
  if (boot.TALE_RUNNER_NODE_COMPILE_CACHE)
    env.NODE_COMPILE_CACHE = boot.TALE_RUNNER_NODE_COMPILE_CACHE;
  delete env.TALE_RUNNER_NODE_PATH;
  delete env.TALE_RUNNER_NODE_COMPILE_CACHE;
  return env;
}

function startEngineProcess(
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<EngineHandle> {
  return new Promise((resolve, reject) => {
    const child = spawn(ENTRYPOINT, ['internal-dockerd'], {
      cwd: '/',
      env: environment,
      stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
      detached: true,
    });
    let ready = false;
    let stopPromise: Promise<void> | undefined;
    let finish!: () => void;
    const exited = new Promise<void>((done) => {
      finish = done;
    });
    const stop = () => {
      if (!stopPromise)
        stopPromise = (async () => {
          child.kill('SIGTERM');
          const force = setTimeout(() => {
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                /* Already exited. */
              }
            }
          }, 20_000);
          try {
            await exited;
          } finally {
            clearTimeout(force);
          }
        })();
      return stopPromise;
    };
    let failing = false;
    const fail = (error: Error) => {
      if (failing) return;
      failing = true;
      // Keep the startup promise pending until the prior engine is reaped, so
      // a retry cannot start a second dockerd against the same data directory.
      // This is the cleanup barrier for the child event, not a nested operation.
      // oxlint-disable-next-line promise/no-promise-in-callback
      void stop().then(() => {
        reject(error);
        return;
      });
    };
    const onAbort = () => fail(new Error('Docker startup cancelled'));
    const deadline = setTimeout(
      () => fail(new Error('Docker startup timed out')),
      40_000,
    );
    child.once('error', (error) => {
      finish();
      fail(error);
    });
    child.once('exit', () => {
      clearTimeout(deadline);
      signal.removeEventListener('abort', onAbort);
      finish();
      if (!ready && !failing)
        reject(new Error('Docker startup exited before readiness'));
    });
    const readiness = child.stdio[3];
    if (readiness && 'on' in readiness) {
      let bytes = '';
      readiness.on('data', (data: Buffer) => {
        bytes += data.toString();
        if (bytes.length > 64) {
          fail(new Error('Invalid Docker readiness signal'));
          return;
        }
        if (bytes !== 'READY\n' || ready || failing) return;
        ready = true;
        clearTimeout(deadline);
        signal.removeEventListener('abort', onAbort);
        resolve({ exited, stop });
      });
    }
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function removeStaleSocket(path: string) {
  try {
    const stat = await lstat(path);
    if (!stat.isSocket() || stat.uid !== 0)
      throw new Error('Unsafe Docker socket path');
    await unlink(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
}

export async function runLazyDockerSupervisor() {
  if (process.getuid?.() !== 0)
    throw new Error('Docker supervisor requires root');
  const boot = Object.freeze({ ...process.env });
  const groups = await readFile('/etc/group', 'utf8');
  const group = groups
    .split('\n')
    .find((line) => line.startsWith('docker:'))
    ?.split(':')[2];
  if (!group || !/^\d+$/.test(group)) throw new Error('Docker group missing');
  await mkdir('/var/run/tale-docker', { mode: 0o700, recursive: true });
  const privateDir = await lstat('/var/run/tale-docker');
  if (!privateDir.isDirectory() || privateDir.uid !== 0)
    throw new Error('Unsafe Docker private directory');
  await chmod('/var/run/tale-docker', 0o700);
  await removeStaleSocket(PUBLIC_SOCKET);
  await removeStaleSocket(LAZY_DOCKER_HEALTH_SOCKET);
  const proxy = await createLazyDockerProxy({
    publicSocket: PUBLIC_SOCKET,
    privateSocket: PRIVATE_SOCKET,
    healthSocket: LAZY_DOCKER_HEALTH_SOCKET,
    startEngine: (signal) =>
      startEngineProcess(engineEnvironment(boot), signal),
    canStop: () => engineIsIdle(PRIVATE_SOCKET),
  });
  let runner: ReturnType<typeof spawn> | undefined;
  let shuttingDown = false;
  const shutdown = () => {
    shuttingDown = true;
    runner?.kill('SIGTERM');
    void proxy.close();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    await chown(PUBLIC_SOCKET, 0, Number(group));
    await chmod(PUBLIC_SOCKET, 0o660);
    await chown(LAZY_DOCKER_HEALTH_SOCKET, 0, Number(group));
    await chmod(LAZY_DOCKER_HEALTH_SOCKET, 0o660);
    // Preserve restart-policy services after a Pod/container restart with existing Docker state.
    let hasExistingContainers = false;
    try {
      hasExistingContainers =
        (await readdir('/var/lib/docker/containers')).length > 0;
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error;
    }
    if (hasExistingContainers) await proxy.ensureReady();
    if (shuttingDown) return;
    const runnerEnv = runnerEnvironment(boot);
    runner = spawn(
      '/usr/bin/setpriv',
      [
        '--reuid',
        '10001',
        '--regid',
        '10001',
        '--init-groups',
        '--',
        NODE,
        '/usr/local/lib/tale/runnerd.mjs',
      ],
      { env: runnerEnv, stdio: 'inherit' },
    );
    await new Promise<void>((resolve, reject) => {
      runner?.once('error', reject);
      runner?.once('exit', (code, signal) => {
        process.exitCode = code ?? (signal ? 143 : 1);
        resolve();
      });
    });
  } finally {
    await proxy.close();
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
  }
}
