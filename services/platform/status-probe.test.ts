import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  _resetStatusProbeCache,
  buildStatusFeed,
  COMPONENT_IDS,
  type ComponentResult,
  probeServices,
  renderStatusJson,
  renderStatusPage,
  type StatusFeed,
  type StatusFeedComponent,
  type StatusResult,
} from './status-probe';

function okResponse() {
  return new Response('ok', { status: 200 });
}

function downResponse() {
  return new Response('boom', { status: 503 });
}

/** What `/health/stores` answers: the three flags, 200 when all up. */
function storesResponse(
  stores: { app_db: boolean; knowledge_db: boolean; object_store: boolean },
  status?: number,
) {
  const ok = stores.app_db && stores.knowledge_db && stores.object_store;
  return new Response(JSON.stringify({ ok, service: 'backend', stores }), {
    status: status ?? (ok ? 200 : 503),
    headers: { 'content-type': 'application/json' },
  });
}

const ALL_STORES_UP = { app_db: true, knowledge_db: true, object_store: true };

/**
 * A fetch double that answers by route: the liveness probe (`/ping`) and
 * the stores probe (`/health/stores`) are the two calls one round makes.
 */
function fetchBy(answers: {
  ping?: () => Response | Promise<Response>;
  stores?: () => Response | Promise<Response>;
}) {
  const doFetch = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.endsWith('/ping')) {
      return Promise.resolve((answers.ping ?? okResponse)());
    }
    if (url.endsWith('/health/stores')) {
      return Promise.resolve(
        (answers.stores ?? (() => storesResponse(ALL_STORES_UP)))(),
      );
    }
    return Promise.reject(new Error(`unexpected probe URL ${url}`));
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return doFetch as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const allUp = () => fetchBy({});

// The platform server probes the backend tier ("Application services") and,
// through the backend's own stores verdict, the database and the object
// store it depends on — three rows, one per component id, in page order.
function allUpComponents(): ComponentResult[] {
  return COMPONENT_IDS.map((id) => ({ id, up: true }));
}

function allOperationalFeedComponents(): StatusFeedComponent[] {
  return COMPONENT_IDS.map((id) => ({ id, status: 'operational' as const }));
}

function allOutageFeedComponents(): StatusFeedComponent[] {
  return COMPONENT_IDS.map((id) => ({ id, status: 'outage' as const }));
}

function upOf(result: StatusResult, id: string): boolean | undefined {
  return result.components.find((c) => c.id === id)?.up;
}

beforeEach(() => {
  // Pin the probe target: a developer shell that exports TALE_BACKEND_URL
  // must not change which URL these tests see.
  vi.stubEnv('TALE_BACKEND_URL', 'http://backend-api:3005');
});

afterEach(() => {
  _resetStatusProbeCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('probeServices', () => {
  test('returns operational with every component up when both probes answer', async () => {
    const doFetch = allUp();
    const result = await probeServices(doFetch);
    expect(result.overall).toBe('operational');
    expect(result.components.map((c) => c.id)).toEqual([
      'backend',
      'database',
      'object-store',
    ]);
    expect(result.components.every((c) => c.up)).toBe(true);
    // Two probes per round: the backend's liveness and its stores verdict.
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  test('returns outage with everything down when the backend answers non-2xx', async () => {
    // A backend that is down cannot answer its stores verdict either.
    const doFetch = fetchBy({ ping: downResponse, stores: downResponse });
    const result = await probeServices(doFetch);
    expect(result.overall).toBe('outage');
    expect(result.components.every((c) => !c.up)).toBe(true);
  });

  test('treats fetch rejection (timeout, ECONNREFUSED) as down', async () => {
    const doFetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('outage');
    expect(result.components.every((c) => !c.up)).toBe(true);
  });

  test('discards the liveness response body to avoid memory pressure from upstream', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const body = { cancel } as unknown as ReadableStream;
    const res = new Response('ignored', { status: 200 });
    Object.defineProperty(res, 'body', { value: body });

    await probeServices(fetchBy({ ping: () => res }));

    expect(cancel).toHaveBeenCalled();
  });

  test('serves from cache within TTL without re-probing', async () => {
    const doFetch = allUp();
    let now = 1000;
    const clock = () => now;

    await probeServices(doFetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(2);

    now = 2000; // 1s later — still inside the 5s TTL
    await probeServices(doFetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  test('re-probes after TTL expires', async () => {
    const doFetch = allUp();
    let now = 1000;
    const clock = () => now;

    await probeServices(doFetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(2);

    now = 7000; // 6s later — past the 5s TTL
    await probeServices(doFetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(4);
  });

  test('caches success and failure independently — recovery after TTL', async () => {
    let downNow = true;
    const doFetch = fetchBy({
      ping: () => (downNow ? downResponse() : okResponse()),
      stores: () => (downNow ? downResponse() : storesResponse(ALL_STORES_UP)),
    });
    let now = 1000;
    const clock = () => now;

    const first = await probeServices(doFetch, clock);
    expect(first.overall).toBe('outage');

    downNow = false;
    now = 7000;
    const second = await probeServices(doFetch, clock);
    expect(second.overall).toBe('operational');
  });

  test('single-flight: concurrent callers share one in-flight probe round', async () => {
    const resolvers: Array<(res: Response) => void> = [];
    const doFetch = vi.fn(
      (input: unknown) =>
        new Promise<Response>((resolve) => {
          resolvers.push((res) => {
            resolve(
              String(input).endsWith('/health/stores')
                ? storesResponse(ALL_STORES_UP)
                : res,
            );
          });
        }),
    );

    const a = probeServices(doFetch as unknown as typeof fetch);
    const b = probeServices(doFetch as unknown as typeof fetch);
    const c = probeServices(doFetch as unknown as typeof fetch);

    // All three callers should be waiting on the same probe round —
    // exactly one round (its two probes), not three.
    expect(doFetch).toHaveBeenCalledTimes(2);

    for (const r of resolvers) r(okResponse());
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
  });
});

/**
 * The stores rows come from the backend's `/health/stores` body — a 503
 * there still carries the per-store flags, so the shape is the verdict,
 * and anything that is not that shape reads as every store down.
 */
describe('the stores probe', () => {
  test('reads the per-store flags from a 200 body', async () => {
    const doFetch = fetchBy({
      stores: () =>
        storesResponse({
          app_db: true,
          knowledge_db: true,
          object_store: true,
        }),
    });
    const result = await probeServices(doFetch);
    expect(upOf(result, 'database')).toBe(true);
    expect(upOf(result, 'object-store')).toBe(true);
    const urls = doFetch.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls).toContain('http://backend-api:3005/health/stores');
  });

  test('reads the flags from the 503 the backend answers once a store is down — one store down is a partial degradation', async () => {
    const doFetch = fetchBy({
      stores: () =>
        storesResponse({
          app_db: true,
          knowledge_db: true,
          object_store: false,
        }),
    });
    const result = await probeServices(doFetch);
    expect(result.overall).toBe('degraded');
    expect(upOf(result, 'backend')).toBe(true);
    expect(upOf(result, 'database')).toBe(true);
    expect(upOf(result, 'object-store')).toBe(false);
  });

  test('folds the app database and the knowledge database into the one database row', async () => {
    const doFetch = fetchBy({
      stores: () =>
        storesResponse({
          app_db: true,
          knowledge_db: false,
          object_store: true,
        }),
    });
    const result = await probeServices(doFetch);
    expect(result.overall).toBe('degraded');
    expect(upOf(result, 'database')).toBe(false);
    expect(upOf(result, 'object-store')).toBe(true);
  });

  test.each([
    ['not JSON', () => new Response('<html>', { status: 200 })],
    [
      'a flag missing',
      () =>
        new Response(JSON.stringify({ stores: { app_db: true } }), {
          status: 200,
        }),
    ],
    [
      'a flag that is not a boolean',
      () =>
        new Response(
          JSON.stringify({
            stores: { app_db: 'yes', knowledge_db: true, object_store: true },
          }),
          { status: 200 },
        ),
    ],
    [
      'an unexpected status',
      () =>
        new Response(JSON.stringify({ stores: ALL_STORES_UP }), {
          status: 302,
        }),
    ],
    [
      'a body over the cap',
      () =>
        new Response(
          JSON.stringify({ stores: ALL_STORES_UP, pad: 'x'.repeat(2048) }),
          { status: 200 },
        ),
    ],
  ])(
    'reads %s as every store down, with the backend row untouched',
    async (_label, stores) => {
      const result = await probeServices(fetchBy({ stores }));
      expect(upOf(result, 'backend')).toBe(true);
      expect(upOf(result, 'database')).toBe(false);
      expect(upOf(result, 'object-store')).toBe(false);
      expect(result.overall).toBe('degraded');
    },
  );
});

describe('buildStatusFeed', () => {
  const checkedAt = '2026-05-11T13:45:07.123Z';

  test('up → operational, every component operational', () => {
    const raw: StatusResult = {
      overall: 'operational',
      components: allUpComponents(),
      checkedAt,
    };
    expect(buildStatusFeed(raw)).toEqual({
      status: 'operational',
      checkedAt,
      components: allOperationalFeedComponents(),
    });
  });

  test('down → outage overall, component outage', () => {
    const raw: StatusResult = {
      overall: 'outage',
      components: COMPONENT_IDS.map((id) => ({ id, up: false })),
      checkedAt,
    };
    const feed = buildStatusFeed(raw);
    expect(feed.status).toBe('outage');
    expect(feed.components.find((c) => c.id === 'backend')?.status).toBe(
      'outage',
    );
  });

  test('keeps the component order the page lists', () => {
    const raw: StatusResult = {
      overall: 'degraded',
      components: [
        { id: 'backend', up: true },
        { id: 'database', up: true },
        { id: 'object-store', up: false },
      ],
      checkedAt,
    };
    expect(buildStatusFeed(raw).components).toEqual([
      { id: 'backend', status: 'operational' },
      { id: 'database', status: 'operational' },
      { id: 'object-store', status: 'outage' },
    ]);
  });
});

describe('renderStatusJson', () => {
  const checkedAt = '2026-05-11T13:45:07.123Z';

  test('serialises an operational feed', () => {
    const feed: StatusFeed = {
      status: 'operational',
      checkedAt,
      components: allOperationalFeedComponents(),
    };
    const raw = renderStatusJson(feed);
    expect(JSON.parse(raw)).toEqual(feed);
    // Stable substring keyword-monitor contract — BetterStack / UptimeRobot
    // and friends match on this literal. Don't quietly change the casing or
    // shape without updating this test.
    expect(raw).toContain('"status":"operational"');
  });

  test('serialises an outage feed', () => {
    const feed: StatusFeed = {
      status: 'outage',
      checkedAt,
      components: allOutageFeedComponents(),
    };
    const raw = renderStatusJson(feed);
    expect(JSON.parse(raw)).toEqual(feed);
    expect(raw).toContain('"status":"outage"');
    expect(raw).not.toContain('"status":"operational"');
  });

  test('names the three documented component ids and nothing else', () => {
    const feed: StatusFeed = {
      status: 'operational',
      checkedAt,
      components: allOperationalFeedComponents(),
    };
    const parsed: { components: { id: string }[] } = JSON.parse(
      renderStatusJson(feed),
    );
    expect(parsed.components.map((c) => c.id)).toEqual([
      'backend',
      'database',
      'object-store',
    ]);
  });
});

describe('renderStatusPage', () => {
  const baseFeed: StatusFeed = {
    status: 'operational',
    components: allOperationalFeedComponents(),
    checkedAt: '2026-05-11T13:45:07.123Z',
  };

  const outageFeed: StatusFeed = {
    status: 'outage',
    components: allOutageFeedComponents(),
    checkedAt: baseFeed.checkedAt,
  };

  test('renders English by default', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('All systems operational');
    expect(html).toContain('Last checked');
  });

  test('renders German when Accept-Language starts with de', () => {
    const html = renderStatusPage(baseFeed, 'de-DE,en;q=0.5');
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Alle Systeme verfügbar');
    expect(html).toContain('Zuletzt geprüft');
  });

  test('renders French when Accept-Language starts with fr', () => {
    const html = renderStatusPage(baseFeed, 'fr-FR,en;q=0.5');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Tous les systèmes opérationnels');
    expect(html).toContain('Dernière vérification');
  });

  test('respects first listed language, not later ones', () => {
    const html = renderStatusPage(baseFeed, 'en-US,de;q=0.9');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('Alle Systeme');
  });

  test('renders outage copy + red banner', () => {
    const html = renderStatusPage(outageFeed, '');
    expect(html).toContain('Service outage');
    expect(html).toContain('#fee2e2');
  });

  test('formats checked timestamp as HH:MM:SS UTC', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toContain('13:45:07 UTC');
    expect(html).toContain('datetime="2026-05-11T13:45:07.123Z"');
  });

  test('marks the banner with role=status for screen readers', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toMatch(/<h1 role="status">/);
  });

  test('opts out of search-engine indexing', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test('renders the neutral English component labels — no stack names leaked', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toContain('Application services');
    expect(html).toContain('Database');
    expect(html).toContain('File storage');
    for (const stack of ['Convex', 'RAG', 'Crawler', 'Postgres', 'S3']) {
      expect(html).not.toContain(stack);
    }
  });

  test('renders the German component labels for de locale', () => {
    const html = renderStatusPage(baseFeed, 'de');
    expect(html).toContain('Anwendungsdienste');
    expect(html).toContain('Datenbank');
    expect(html).toContain('Dateispeicher');
  });

  test('shows the status word for the component (not color alone)', () => {
    const upHtml = renderStatusPage(baseFeed, '');
    expect(upHtml).toContain('>Operational<');

    const downHtml = renderStatusPage(outageFeed, '');
    expect(downHtml).toContain('>Unavailable<');
  });

  test('uses German status words for de locale', () => {
    expect(renderStatusPage(baseFeed, 'de-DE')).toContain('>Verfügbar<');
    expect(renderStatusPage(outageFeed, 'de-DE')).toContain(
      '>Nicht verfügbar<',
    );
  });

  test('uses French status words for fr locale', () => {
    expect(renderStatusPage(baseFeed, 'fr-FR')).toContain('>Opérationnel<');
    expect(renderStatusPage(outageFeed, 'fr-FR')).toContain('>Indisponible<');
  });

  test('marks status dots aria-hidden so screen readers rely on the text label', () => {
    const html = renderStatusPage(baseFeed, '');
    // Every dot element carries aria-hidden so the visible status text is
    // the canonical signal for assistive tech — one dot per component.
    const dots = html.match(/<span class="dot"[^>]*>/g) ?? [];
    expect(dots.length).toBe(COMPONENT_IDS.length);
    for (const dot of dots) expect(dot).toContain('aria-hidden="true"');
  });

  test('shows a degraded page with the one down row marked, the rest up', () => {
    const html = renderStatusPage(
      {
        status: 'degraded',
        components: [
          { id: 'backend', status: 'operational' },
          { id: 'database', status: 'operational' },
          { id: 'object-store', status: 'outage' },
        ],
        checkedAt: baseFeed.checkedAt,
      },
      '',
    );
    expect(html).toContain('Partial degradation');
    expect(html.match(/>Operational</g)?.length).toBe(2);
    expect(html.match(/>Unavailable</g)?.length).toBe(1);
  });
});

describe('backend component', () => {
  test('probes /ping and /health/stores on the configured backend', async () => {
    vi.stubEnv('TALE_BACKEND_URL', 'http://backend-api:3005/');
    const doFetch = allUp();
    const result = await probeServices(doFetch);
    expect(result.components.map((c) => c.id)).toEqual([
      'backend',
      'database',
      'object-store',
    ]);
    expect(result.overall).toBe('operational');
    const urls = doFetch.mock.calls.map((call: unknown[]) => String(call[0]));
    // Trailing slash normalized — never `//ping`.
    expect(urls).toContain('http://backend-api:3005/ping');
    expect(urls).toContain('http://backend-api:3005/health/stores');
  });

  test('falls back to loopback when TALE_BACKEND_URL is unset', async () => {
    // A missing env var must not silently drop the probes: an empty
    // component list would aggregate to "operational" and hide an outage.
    vi.stubEnv('TALE_BACKEND_URL', '');
    const doFetch = allUp();
    const result = await probeServices(doFetch);
    expect(result.components.map((c) => c.id)).toEqual([
      'backend',
      'database',
      'object-store',
    ]);
    const urls = doFetch.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(urls).toContain('http://127.0.0.1:3005/ping');
    expect(urls).toContain('http://127.0.0.1:3005/health/stores');
  });

  test('a down backend reads as an outage', async () => {
    const doFetch = fetchBy({ ping: downResponse, stores: downResponse });
    const result = await probeServices(doFetch);
    expect(result.overall).toBe('outage');
    expect(upOf(result, 'backend')).toBe(false);
  });

  test('renders a stack-free label for every component in every shipped locale', () => {
    const feed = buildStatusFeed({
      overall: 'outage',
      components: COMPONENT_IDS.map((id) => ({ id, up: false })),
      checkedAt: new Date(0).toISOString(),
    });
    const en = renderStatusPage(feed, 'en');
    const de = renderStatusPage(feed, 'de');
    const fr = renderStatusPage(feed, 'fr');
    for (const label of ['Application services', 'Database', 'File storage']) {
      expect(en).toContain(label);
    }
    for (const label of ['Anwendungsdienste', 'Datenbank', 'Dateispeicher']) {
      expect(de).toContain(label);
    }
    for (const label of [
      'Services applicatifs',
      'Base de données',
      'Stockage de fichiers',
    ]) {
      expect(fr).toContain(label);
    }
  });
});
