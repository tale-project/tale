import {
  ANALYTICS_CONFIG_ID,
  analyticsPayloadSchema,
  analyticsReferrer,
  publicAnalyticsSchema,
  type AnalyticsEvent,
  type AnalyticsPayload,
} from './config';

declare global {
  interface Window {
    umami?: { track: (payload: AnalyticsPayload) => Promise<void> };
  }
}

function optedOut(): boolean {
  const navigator = window.navigator;
  return (
    navigator.doNotTrack === '1' ||
    navigator.doNotTrack === 'yes' ||
    ('globalPrivacyControl' in navigator &&
      navigator.globalPrivacyControl === true)
  );
}

/** Bind once at client bootstrap. Only resolved, known routes enter the tracker. */
export function initBrowserAnalytics() {
  if (typeof window === 'undefined' || optedOut()) return undefined;
  let input: unknown;
  try {
    input = JSON.parse(
      document.getElementById(ANALYTICS_CONFIG_ID)?.textContent ?? 'null',
    );
  } catch {
    return undefined;
  }
  const parsed = publicAnalyticsSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const config = parsed.data;
  let currentPath: string | undefined;
  let currentLocation: string | undefined;
  let referrer = analyticsReferrer(document.referrer, window.location.origin);
  const pending: AnalyticsPayload[] = [];
  let ready = false;

  const send = (path: string, name?: AnalyticsEvent) => {
    if (optedOut()) return;
    const payload = analyticsPayloadSchema.safeParse({
      website: config.websiteId,
      url: path,
      hostname: window.location.hostname,
      language: window.navigator.language,
      screen: `${window.screen.width}x${window.screen.height}`,
      referrer,
      ...(name ? { name } : {}),
    });
    if (!payload.success) return;
    if (ready) void window.umami?.track(payload.data);
    else if (pending.length < 20) pending.push(payload.data);
  };
  const script = document.createElement('script');
  script.src = `${config.proxyPath}/script.js`;
  script.async = true;
  script.dataset.websiteId = config.websiteId;
  script.dataset.hostUrl = config.proxyPath;
  script.dataset.autoTrack = 'false';
  script.dataset.doNotTrack = 'true';
  script.dataset.excludeSearch = 'true';
  script.dataset.excludeHash = 'true';
  script.dataset.fetchCredentials = 'omit';
  script.referrerPolicy = 'no-referrer';
  script.addEventListener(
    'load',
    () => {
      ready = true;
      if (!optedOut())
        for (const payload of pending) void window.umami?.track(payload);
      pending.length = 0;
    },
    { once: true },
  );
  script.addEventListener(
    'error',
    () => {
      pending.length = 0;
    },
    { once: true },
  );
  document.head.append(script);

  return {
    page(path: string | undefined) {
      const location = window.location.pathname;
      // Invalidation/preload resolutions and query/hash-only changes are not
      // pageviews. A second resource on the same private template still is.
      if (path === currentPath && location === currentLocation) return;
      currentPath = path;
      currentLocation = location;
      if (!path) return;
      send(path);
      referrer = '';
    },
    event(name: AnalyticsEvent) {
      if (currentPath) send(currentPath, name);
    },
  };
}

let analytics: ReturnType<typeof initBrowserAnalytics>;

/** Input is a router definition, never a location or a substituted match path. */
export function analyticsRouteTemplate(template: string): string | undefined {
  if (template.endsWith('/$')) return undefined;
  return template.replace(/\$([a-zA-Z0-9_]+)/g, ':$1');
}

export function startBrowserAnalytics(
  subscribe: (onResolved: () => void) => () => void,
  route: () => string | undefined,
): void {
  if (analytics) return;
  analytics = initBrowserAnalytics();
  if (analytics) subscribe(() => analytics?.page(route()));
}

export function trackAnalyticsEvent(name: AnalyticsEvent): void {
  analytics?.event(name);
}
