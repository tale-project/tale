// Minimal Docker Engine API client over the unix socket.
//
// Only two operations are ever issued — list containers by compose label and
// restart a container by id. There is deliberately no `create`/`exec`/`run`
// surface: this service can ONLY bounce existing allowlisted compose services,
// which is a far smaller capability than the sandbox spawner's `docker run`.

import http from 'node:http';

const SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';

// Upper bound on a single socket call. A restart waits up to ~10s for graceful
// stop, so this sits comfortably above that; its job is to fail fast when the
// daemon is wedged rather than hang the request handler forever.
const REQUEST_TIMEOUT_MS = 30_000;

function dockerRequest(
  method: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: SOCKET,
        method,
        path,
        headers: { Host: 'localhost' },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy(
        new Error(`docker socket timeout after ${REQUEST_TIMEOUT_MS}ms`),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Container ids for a compose service, scoped to the project when known so we
 * never touch another stack's containers on the same host.
 */
export async function listContainerIds(
  project: string | undefined,
  service: string,
): Promise<string[]> {
  const label = [`com.docker.compose.service=${service}`];
  if (project) label.push(`com.docker.compose.project=${project}`);
  const filters = encodeURIComponent(JSON.stringify({ label }));
  const res = await dockerRequest(
    'GET',
    `/containers/json?all=false&filters=${filters}`,
  );
  if (res.status !== 200) {
    throw new Error(`docker list failed (${res.status}): ${res.body}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- docker /containers/json returns an array of {Id,...}
  const arr = JSON.parse(res.body) as { Id: string }[];
  return arr.map((c) => c.Id);
}

export async function restartContainer(
  id: string,
  timeoutS = 10,
): Promise<void> {
  const res = await dockerRequest(
    'POST',
    `/containers/${id}/restart?t=${timeoutS}`,
  );
  // 204 No Content on success.
  if (res.status !== 204) {
    throw new Error(`docker restart ${id} failed (${res.status}): ${res.body}`);
  }
}

export async function dockerReachable(): Promise<boolean> {
  try {
    const res = await dockerRequest('GET', '/_ping');
    return res.status === 200;
  } catch (err) {
    console.warn(
      `[controller] docker ping failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
