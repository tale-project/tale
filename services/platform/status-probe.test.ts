import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  _resetStatusProbeCache,
  type ComponentResult,
  probeServices,
  renderStatusPage,
  type StatusResult,
} from './status-probe';

function okResponse() {
  return new Response('ok', { status: 200 });
}

function downResponse() {
  return new Response('boom', { status: 503 });
}

function allUpComponents(): ComponentResult[] {
  return [
    { id: 'convex', up: true },
    { id: 'rag', up: true },
    { id: 'crawler', up: true },
  ];
}

afterEach(() => {
  _resetStatusProbeCache();
  vi.restoreAllMocks();
});

describe('probeServices', () => {
  test('returns operational with all components up when every probe returns 2xx', async () => {
    const doFetch = vi.fn(() => Promise.resolve(okResponse()));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('operational');
    expect(result.components.map((c) => c.id)).toEqual([
      'convex',
      'rag',
      'crawler',
    ]);
    expect(result.components.every((c) => c.up)).toBe(true);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  test('returns degraded with the failing component marked down', async () => {
    // Match RAG by port (8001) rather than substring — RAG_URL defaults to
    // http://localhost:8001 in dev, which has no 'rag' substring.
    const doFetch = vi.fn((url: string) =>
      Promise.resolve(url.includes(':8001') ? downResponse() : okResponse()),
    );
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('degraded');
    expect(result.components.find((c) => c.id === 'rag')?.up).toBe(false);
    expect(result.components.find((c) => c.id === 'convex')?.up).toBe(true);
    expect(result.components.find((c) => c.id === 'crawler')?.up).toBe(true);
  });

  test('returns outage with every component marked down when every probe fails', async () => {
    const doFetch = vi.fn(() => Promise.resolve(downResponse()));
    const result = await probeServices(doFetch as unknown as typeof fetch);
    expect(result.overall).toBe('outage');
    expect(result.components.every((c) => !c.up)).toBe(true);
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
    expect(doFetch).toHaveBeenCalledTimes(3);

    now = 2000; // 1s later — still inside the 5s TTL
    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(3);
  });

  test('re-probes after TTL expires', async () => {
    const doFetch = vi.fn(() => Promise.resolve(okResponse()));
    let now = 1000;
    const clock = () => now;

    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(3);

    now = 7000; // 6s later — past the 5s TTL
    await probeServices(doFetch as unknown as typeof fetch, clock);
    expect(doFetch).toHaveBeenCalledTimes(6);
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
    // exactly 3 fetches (one per backend), not 9.
    expect(doFetch).toHaveBeenCalledTimes(3);

    for (const r of resolvers) r(okResponse());
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toBe(rb);
    expect(rb).toBe(rc);
  });
});

describe('renderStatusPage', () => {
  const baseResult: StatusResult = {
    overall: 'operational',
    components: allUpComponents(),
    checkedAt: '2026-05-11T13:45:07.123Z',
  };

  test('renders English by default', () => {
    const html = renderStatusPage(baseResult, '');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('All systems operational');
    expect(html).toContain('Last checked');
  });

  test('renders German when Accept-Language starts with de', () => {
    const html = renderStatusPage(baseResult, 'de-DE,en;q=0.5');
    expect(html).toContain('<html lang="de">');
    expect(html).toContain('Alle Systeme verfügbar');
    expect(html).toContain('Zuletzt geprüft');
  });

  test('renders French when Accept-Language starts with fr', () => {
    const html = renderStatusPage(baseResult, 'fr-FR,en;q=0.5');
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain('Tous les systèmes opérationnels');
    expect(html).toContain('Dernière vérification');
  });

  test('respects first listed language, not later ones', () => {
    const html = renderStatusPage(baseResult, 'en-US,de;q=0.9');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('Alle Systeme');
  });

  test('renders degraded copy + amber banner', () => {
    const html = renderStatusPage(
      {
        overall: 'degraded',
        components: [
          { id: 'convex', up: true },
          { id: 'rag', up: false },
          { id: 'crawler', up: true },
        ],
        checkedAt: baseResult.checkedAt,
      },
      '',
    );
    expect(html).toContain('Partial degradation');
    expect(html).toContain('#fef3c7');
  });

  test('renders outage copy + red banner', () => {
    const html = renderStatusPage(
      {
        overall: 'outage',
        components: [
          { id: 'convex', up: false },
          { id: 'rag', up: false },
          { id: 'crawler', up: false },
        ],
        checkedAt: baseResult.checkedAt,
      },
      '',
    );
    expect(html).toContain('Service outage');
    expect(html).toContain('#fee2e2');
  });

  test('formats checked timestamp as HH:MM:SS UTC', () => {
    const html = renderStatusPage(baseResult, '');
    expect(html).toContain('13:45:07 UTC');
    expect(html).toContain('datetime="2026-05-11T13:45:07.123Z"');
  });

  test('marks the banner with role=status for screen readers', () => {
    const html = renderStatusPage(baseResult, '');
    expect(html).toMatch(/<h1 role="status">/);
  });

  test('opts out of search-engine indexing', () => {
    const html = renderStatusPage(baseResult, '');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  test('renders neutral English component labels — no stack names leaked', () => {
    const html = renderStatusPage(baseResult, '');
    expect(html).toContain('Application');
    expect(html).toContain('Knowledge base');
    expect(html).toContain('Web &amp; document services');
    expect(html).not.toContain('Convex');
    expect(html).not.toContain('RAG');
    expect(html).not.toContain('Crawler');
  });

  test('renders German component labels for de locale', () => {
    const html = renderStatusPage(baseResult, 'de');
    expect(html).toContain('Anwendung');
    expect(html).toContain('Wissensdatenbank');
    expect(html).toContain('Web- &amp; Dokumentendienste');
  });

  test('renders French component labels for fr locale', () => {
    const html = renderStatusPage(baseResult, 'fr');
    expect(html).toContain('Base de connaissances');
    expect(html).toContain('Services web et documents');
  });

  test('shows status word per component (not color alone)', () => {
    const html = renderStatusPage(
      {
        overall: 'degraded',
        components: [
          { id: 'convex', up: true },
          { id: 'rag', up: false },
          { id: 'crawler', up: true },
        ],
        checkedAt: baseResult.checkedAt,
      },
      '',
    );
    // Two operational, one unavailable.
    const operationalMatches = html.match(/>Operational</g) ?? [];
    expect(operationalMatches.length).toBe(2);
    expect(html).toContain('>Unavailable<');
  });

  test('uses German status words for de locale', () => {
    const html = renderStatusPage(
      {
        overall: 'degraded',
        components: [
          { id: 'convex', up: true },
          { id: 'rag', up: false },
          { id: 'crawler', up: true },
        ],
        checkedAt: baseResult.checkedAt,
      },
      'de-DE',
    );
    expect(html).toContain('>Verfügbar<');
    expect(html).toContain('>Nicht verfügbar<');
  });

  test('uses French status words for fr locale', () => {
    const html = renderStatusPage(
      {
        overall: 'degraded',
        components: [
          { id: 'convex', up: true },
          { id: 'rag', up: false },
          { id: 'crawler', up: true },
        ],
        checkedAt: baseResult.checkedAt,
      },
      'fr-FR',
    );
    expect(html).toContain('>Opérationnel<');
    expect(html).toContain('>Indisponible<');
  });

  test('marks status dots aria-hidden so screen readers rely on the text label', () => {
    const html = renderStatusPage(baseResult, '');
    // Every dot element carries aria-hidden so the visible status text is
    // the canonical signal for assistive tech.
    const dots = html.match(/<span class="dot"[^>]*>/g) ?? [];
    expect(dots.length).toBe(3);
    for (const dot of dots) expect(dot).toContain('aria-hidden="true"');
  });
});
