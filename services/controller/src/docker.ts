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
    // Settle exactly once and always clear the deadline. Without this, both a
    // late 'error' after 'end' and the deadline firing post-settle could call
    // resolve/reject twice or leak the timer. `deadline` is a forward reference
    // here (assigned just below) — guard only runs on async I/O events, well
    // after it is initialised.
    let settled = false;
    const guard = (): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(deadline);
      return true;
    };
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
        res.on('end', () => {
          if (guard()) resolve({ status: res.statusCode ?? 0, body: data });
        });
        // A socket closed mid-body (daemon restart, truncated response) emits
        // 'error' on the RESPONSE stream — not on `req`. Without handling it the
        // promise would never settle and the request handler hangs forever.
        res.on('error', (err) => {
          if (guard()) reject(err);
        });
      },
    );
    // Absolute upper bound. The `timeout` option above is socket-INACTIVITY only
    // and does NOT fire once the socket has already closed after headers, so it
    // cannot bound a truncated response — this deadline can. destroy() surfaces
    // through the `req` 'error' handler below.
    const deadline = setTimeout(() => {
      req.destroy(
        new Error(`docker request deadline after ${REQUEST_TIMEOUT_MS}ms`),
      );
    }, REQUEST_TIMEOUT_MS);
    req.on('timeout', () => {
      req.destroy(
        new Error(`docker socket timeout after ${REQUEST_TIMEOUT_MS}ms`),
      );
    });
    req.on('error', (err) => {
      if (guard()) reject(err);
    });
    req.end();
  });
}

/**
 * Container ids for one or more candidate compose service labels, scoped to a
 * set of candidate projects so we never touch another stack on the same host.
 *
 * Why candidates rather than a single (project, service): rotatable services
 * (e.g. `rag`) are deployed blue/green by the CLI as service `rag-<color>` under
 * project `<project>-<color>`, while the hand-written compose runs them as plain
 * `rag` under `<project>`. Matching `{rag, rag-blue, rag-green}` across
 * `{project, project-blue, project-green}` resolves the live container in BOTH
 * topologies. Docker's `label` filters are AND-combined, so OR is done by one
 * list call per service label; the project is then filtered from the returned
 * labels (exact membership — never a prefix — so a sibling stack is untouched).
 */
export async function listContainerIds(
  projects: string[] | undefined,
  services: string[],
): Promise<string[]> {
  const ids = new Set<string>();
  for (const service of services) {
    const filters = encodeURIComponent(
      JSON.stringify({ label: [`com.docker.compose.service=${service}`] }),
    );
    const res = await dockerRequest(
      'GET',
      `/containers/json?all=false&filters=${filters}`,
    );
    if (res.status !== 200) {
      throw new Error(`docker list failed (${res.status}): ${res.body}`);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- docker /containers/json returns an array of {Id,Labels,...}
    const arr = JSON.parse(res.body) as {
      Id: string;
      Labels?: Record<string, string>;
    }[];
    for (const c of arr) {
      if (projects) {
        const proj = c.Labels?.['com.docker.compose.project'];
        if (proj === undefined || !projects.includes(proj)) continue;
      }
      ids.add(c.Id);
    }
  }
  return [...ids];
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
