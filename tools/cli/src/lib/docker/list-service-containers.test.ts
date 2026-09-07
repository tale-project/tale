import { describe, expect, mock, test } from 'bun:test';

const dockerMock = mock();
mock.module('./docker', () => ({ docker: dockerMock }));

const {
  composeCreatedContainerFilters,
  listComposeContainers,
  listRunningServiceContainers,
} = await import('./list-service-containers');

/**
 * The regression this guards is a false POSITIVE, which is the dangerous
 * direction: what this lister returns is what a colour teardown stops.
 *
 * `docker compose build` bakes `com.docker.compose.project` and
 * `com.docker.compose.service` into the image it produces, so anything later
 * started from that image with a plain `docker run` inherits both labels and
 * answers the same filter. Observed on a real daemon: a throwaway
 * `docker run … tale-db` for an integration run reports
 * `project=tale, service=db` exactly like the compose-managed one.
 *
 * `container-number` is what separates them — never an image label, always
 * stamped by Compose at container creation. The rows below use the real
 * shapes taken off `docker ps` (Docker 29.1.3, Compose 2.40.3).
 */

function psReturns(lines: string[]): void {
  dockerMock.mockReset();
  dockerMock.mockResolvedValue({
    success: true,
    stdout: lines.join('\n'),
    stderr: '',
    exitCode: 0,
  });
}

/** name, service, container-number, state, oneoff — the lister's format. */
const row = (
  name: string,
  service: string,
  number: string,
  state = 'running',
  oneoff = 'False',
) => [name, service, number, state, oneoff].join('\t');

describe('listComposeContainers', () => {
  test('returns the replicas Compose created, in replica order', async () => {
    psReturns([
      row('tale-blue-backend-api-2', 'backend-api', '2'),
      row('tale-blue-backend-api-1', 'backend-api', '1'),
      row('tale-blue-platform-1', 'platform', '1'),
    ]);

    expect(await listComposeContainers('tale-blue')).toEqual([
      {
        name: 'tale-blue-backend-api-1',
        service: 'backend-api',
        index: 1,
        running: true,
      },
      {
        name: 'tale-blue-backend-api-2',
        service: 'backend-api',
        index: 2,
        running: true,
      },
      {
        name: 'tale-blue-platform-1',
        service: 'platform',
        index: 1,
        running: true,
      },
    ]);
  });

  // THE false positive: a hand-run container off a compose-built image.
  test('ignores a container that only inherited the labels from its image', async () => {
    psReturns([
      row('tale-db', 'db', '1'),
      // `docker run … tale-db:latest` — no container-number, because Compose
      // never created it.
      row('tale-backend-itest', 'db', ''),
    ]);

    expect((await listComposeContainers('tale')).map((c) => c.name)).toEqual([
      'tale-db',
    ]);
  });

  test('ignores a `docker compose run` one-off', async () => {
    psReturns([
      row('tale-blue-backend-api-1', 'backend-api', '1'),
      row(
        'tale-blue-backend-api-run-abc',
        'backend-api',
        '1',
        'running',
        'True',
      ),
    ]);

    expect(
      (await listComposeContainers('tale-blue', 'backend-api')).map(
        (c) => c.name,
      ),
    ).toEqual(['tale-blue-backend-api-1']);
  });

  test('narrows to one service and keeps stopped ones (teardown needs them)', async () => {
    psReturns([
      row('tale-blue-backend-worker-1', 'backend-worker', '1', 'exited'),
    ]);

    const found = await listComposeContainers('tale-blue', 'backend-worker');
    expect(found).toHaveLength(1);
    expect(found[0]?.running).toBe(false);
    const argv = String(dockerMock.mock.calls[0]?.join(' '));
    expect(argv).toContain('label=com.docker.compose.project=tale-blue');
    expect(argv).toContain('label=com.docker.compose.service=backend-worker');
    // `-a` so a stopped replica is still found and removed.
    expect(dockerMock.mock.calls[0]).toContain('-a');
  });

  test('is empty rather than throwing when docker fails', async () => {
    dockerMock.mockReset();
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'daemon not running',
      exitCode: 1,
    });
    expect(await listComposeContainers('tale-blue')).toEqual([]);
  });
});

describe('composeCreatedContainerFilters', () => {
  test('requires a container-number so an image-label docker run is excluded', () => {
    expect(composeCreatedContainerFilters('tale-blue')).toEqual([
      '--filter',
      'label=com.docker.compose.project=tale-blue',
      '--filter',
      'label=com.docker.compose.container-number',
    ]);
  });
});

describe('listRunningServiceContainers', () => {
  test('drops the stopped ones and returns names in replica order', async () => {
    psReturns([
      row('tale-blue-backend-api-1', 'backend-api', '1', 'exited'),
      row('tale-blue-backend-api-2', 'backend-api', '2'),
    ]);

    expect(
      await listRunningServiceContainers('tale-blue', 'backend-api'),
    ).toEqual(['tale-blue-backend-api-2']);
  });
});
