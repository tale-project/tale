import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  _resetStatusProbeCache,
  buildStatusFeed,
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

// RAG + crawler now run in-process inside Convex, so the only backend the
// platform server can reach is Convex ("Application"). The probe set is a
// single component; the wider OverallStatus vocabulary is kept for a future
// per-subsystem probe.
function allUpComponents(): ComponentResult[] {
  return [{ id: 'convex', up: true }];
}

function allOperationalFeedComponents(): StatusFeedComponent[] {
  return [{ id: 'convex', status: 'operational' }];
}

afterEach(() => {
  _resetStatusProbeCache();
  vi.restoreAllMocks();
});

describe('probeServices', () => {
  test('returns operational with the application up when the probe returns 2xx', async () => {
    const doFetch = vi.fn(() => Promise.resolve(okResponse()));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('operational');
    expect(result.components.map((c) => c.id)).toEqual(['convex']);
    expect(result.components.every((c) => c.up)).toBe(true);
    // One backend probe (Convex /version) — rag/crawler are in-process.
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  test('returns outage with the application down when the probe returns non-2xx', async () => {
    const doFetch = vi.fn(() => Promise.resolve(downResponse()));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('outage');
    expect(result.components.find((c) => c.id === 'convex')?.up).toBe(false);
  });

  test('treats fetch rejection (timeout, ECONNREFUSED) as down', async () => {
    const doFetch = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('outage');
    expect(result.components.every((c) => !c.up)).toBe(true);
  });

  test('discards response body to avoid memory pressure from upstream', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const body = { cancel } as unknown as ReadableStream;
    const res = new Response('ignored', { status: 200 });
    Object.defineProperty(res, 'body', { value: body });

    const doFetch = vi.fn(() => Promise.resolve(res));
    await probeServices(doFetch as unknown as typeof fetch);

    expect(cancel).toHaveBeenCalled();
  });

  test('serves from cache within TTL without re-probing', async () => {
    const doFetch = vi.fn(() => Promise.resolve(okResponse()));
    let now = 1000;
    const clock = () => now;

    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(1);

    now = 2000; // 1s later — still inside the 5s TTL
    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  test('re-probes after TTL expires', async () => {
    const doFetch = vi.fn(() => Promise.resolve(okResponse()));
    let now = 1000;
    const clock = () => now;

    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(1);

    now = 7000; // 6s later — past the 5s TTL
    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });

  test('caches success and failure independently — recovery after TTL', async () => {
    let downNow = true;
    const doFetch = vi.fn(() =>
      Promise.resolve(downNow ? downResponse() : okResponse()),
    );
    let now = 1000;
    const clock = () => now;

    const first = await probeServices(
      doFetch as unknown as typeof fetch,
      clock,
    );
    expect(first.overall).toBe('outage');

    downNow = false;
    now = 7000;
    const second = await probeServices(
      doFetch as unknown as typeof fetch,
      clock,
    );
    expect(second.overall).toBe('operational');
  });

  test('single-flight: concurrent callers share one in-flight probe round', async () => {
    const resolvers: Array<(res: Response) => void> = [];
    const doFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const a = probeServices(doFetch as unknown as typeof fetch);
    const b = probeServices(doFetch as unknown as typeof fetch);
    const c = probeServices(doFetch as unknown as typeof fetch);

    // All three callers should be waiting on the same probe round —
    // exactly one fetch (the single backend), not three.
    expect(doFetch).toHaveBeenCalledTimes(1);

    for (const r of resolvers) r(okResponse());
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
  });
});

describe('buildStatusFeed', () => {
  const checkedAt = '2026-05-11T13:45:07.123Z';

  test('up → operational, component operational', () => {
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
      components: [{ id: 'convex', up: false }],
      checkedAt,
    };
    const feed = buildStatusFeed(raw);
    expect(feed.status).toBe('outage');
    expect(feed.components.find((c) => c.id === 'convex')?.status).toBe(
      'outage',
    );
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
      components: [{ id: 'convex', status: 'outage' }],
    };
    const raw = renderStatusJson(feed);
    expect(JSON.parse(raw)).toEqual(feed);
    expect(raw).toContain('"status":"outage"');
    expect(raw).not.toContain('"status":"operational"');
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
    components: [{ id: 'convex', status: 'outage' }],
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

  test('renders the neutral English component label — no stack names leaked', () => {
    const html = renderStatusPage(baseFeed, '');
    expect(html).toContain('Application');
    expect(html).not.toContain('Convex');
    expect(html).not.toContain('RAG');
    expect(html).not.toContain('Crawler');
  });

  test('renders the German component label for de locale', () => {
    const html = renderStatusPage(baseFeed, 'de');
    expect(html).toContain('Anwendung');
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
    // the canonical signal for assistive tech.
    const dots = html.match(/<span class="dot"[^>]*>/g) ?? [];
    expect(dots.length).toBe(1);
    for (const dot of dots) expect(dot).toContain('aria-hidden="true"');
  });
});
