// Dependency health is diagnostic, not daemon liveness: file-only work remains
// usable when an optional Docker or transparent-egress helper is unavailable.
import { request } from 'node:http';
import { createConnection } from 'node:net';

export interface DependencyHealth {
  docker?: { ok: boolean };
  egress?: { ok: boolean };
}

export function dockerHealthy(
  socketPath = '/var/run/docker.sock',
  timeoutMs = 1_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ socketPath, path: '/_ping' }, (res) => {
      res.resume();
      finish(res.statusCode === 200);
    });
    const timer = setTimeout(() => finish(false), timeoutMs);
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      req.destroy();
      resolve(ok);
    };
    req.on('error', () => finish(false));
    req.end();
  });
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

let cached: { at: number; value: DependencyHealth } | undefined;
let pending: Promise<DependencyHealth> | undefined;
export async function dependencyHealth(): Promise<
  DependencyHealth | undefined
> {
  const docker = process.env.TALE_DIND === '1';
  const egress = process.env.TALE_TRANSPARENT_EGRESS === '1';
  if (!docker && !egress) return undefined;
  if (cached && Date.now() - cached.at < 5_000) return cached.value;
  pending ??= (async () => {
    const [dockerOk, egressOk] = await Promise.all([
      docker ? dockerHealthy() : undefined,
      egress ? egressHealthy() : undefined,
    ]);
    const value: DependencyHealth = {
      ...(dockerOk === undefined ? {} : { docker: { ok: dockerOk } }),
      ...(egressOk === undefined ? {} : { egress: { ok: egressOk } }),
    };
    cached = { at: Date.now(), value };
    return value;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
