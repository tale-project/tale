// Docker diagnostics reuse the readiness probe's snapshot. Optional egress is
// diagnostic only, so its failure never hides daemon liveness or file access.
import { createConnection } from 'node:net';

export interface DependencyHealth {
  docker?: { ok: boolean };
  egress?: { ok: boolean };
}

function egressHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 12346 });
    const timer = setTimeout(() => finish(false), 1_000);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

let cached: { at: number; ok: boolean } | undefined;
let pending: Promise<boolean> | undefined;
async function egressSnapshot(): Promise<boolean> {
  if (cached && Date.now() - cached.at < 5_000) return cached.ok;
  pending ??= egressHealthy()
    .then((ok) => {
      cached = { at: Date.now(), ok };
      return ok;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}

export async function dependencyHealth(
  dockerReady?: boolean,
): Promise<DependencyHealth | undefined> {
  const egress = process.env.TALE_TRANSPARENT_EGRESS === '1';
  if (dockerReady === undefined && !egress) return undefined;
  return {
    ...(dockerReady === undefined ? {} : { docker: { ok: dockerReady } }),
    ...(egress ? { egress: { ok: await egressSnapshot() } } : {}),
  };
}
