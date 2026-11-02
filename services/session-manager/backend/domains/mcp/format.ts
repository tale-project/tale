// What the MCP tools answer with: plain objects and text a model can read,
// built from the app's own objects. The keys are snake_case, as assistants have
// always read them (the API of the web page is camelCase).

import type {
  ImportResult,
  Proxy,
  Session,
  SessionStatus,
} from '../../../lib/api/schemas.ts';
import type { PageDialog, PageReading, Tab } from '../browser/remote.ts';
import { untrusted } from './untrusted.ts';

export interface SessionText {
  id: number;
  name: string;
  status: SessionStatus;
  error: string | null;
  ip: string | null;
  country: string | null;
  proxy: string | null;
  os: string;
  locale: string | null;
  timezone: string | null;
  /** What the session reports about where it is; it fits the proxy while `matches_ip` is true. */
  location: {
    ip: string;
    country: string | null;
    latitude: number;
    longitude: number;
    matches_ip: boolean | null;
  } | null;
}

export function sessionText(item: Session): SessionText {
  const { proxy, location } = item;
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    error: item.error,
    ip: proxy?.exitIp ?? null,
    country: proxy?.country ?? null,
    proxy: proxy?.display ?? null,
    os: item.os,
    locale: item.fingerprint.locale,
    timezone: item.fingerprint.timezone,
    location:
      location === null
        ? null
        : {
            ip: location.ip,
            country: location.country,
            latitude: location.latitude,
            longitude: location.longitude,
            matches_ip: location.inSync,
          },
  };
}

export function sessionDetails(item: Session) {
  const { fingerprint } = item;
  return {
    ...sessionText(item),
    fingerprint: {
      user_agent: fingerprint.userAgent,
      platform: fingerprint.platform,
      screen: fingerprint.screen,
      gpu: fingerprint.gpu,
      locale: fingerprint.locale,
      timezone: fingerprint.timezone,
    },
    created_at: item.createdAt,
    last_started_at: item.lastStartedAt,
  };
}

export function proxyText(item: Proxy) {
  return {
    id: item.id,
    proxy: item.display, // never the password
    health: item.check.status,
    exit_ip: item.check.exitIp,
    country: item.check.country,
    latency_ms: item.check.latencyMs,
    error: item.check.error,
    session: item.session?.name ?? null,
    same_exit_ip_as_session: item.sameIpAs?.name ?? null,
  };
}

export function importedText(result: ImportResult) {
  return {
    summary: result.summary,
    added: result.added.map((proxy) => ({
      id: proxy.id,
      proxy: proxy.display,
    })),
    duplicates: result.duplicates.map((duplicate) => ({
      line: duplicate.line,
      proxy: duplicate.display,
    })),
    errors: result.errors.map((error) => ({
      line: error.line,
      input: error.input,
      message: error.message,
    })),
  };
}

export function tabText(item: Tab) {
  return {
    id: item.id,
    url: item.url,
    title: item.title,
    active: item.active,
    loading: item.loading,
  };
}

/** A value as JSON in a block of what pages say: the address and title of a tab are the page's. */
export function framedJson(value: unknown, code?: string): string {
  return untrusted(JSON.stringify(value, null, 2), code);
}

/** The tabs: their addresses and titles are what the pages say. */
export function tabsText(tabs: readonly Tab[], code?: string): string {
  return framedJson(tabs.map(tabText), code);
}

/**
 * Tells that the page waits for a dialog to be answered (empty without one).
 * What the dialogs say is the page's, so it is in a block of its own.
 */
export function dialogNotice(
  dialogs: readonly PageDialog[],
  code?: string,
): string {
  if (dialogs.length === 0) return '';
  const lines = dialogs.map((item) => {
    const article = /^[aeiou]/i.test(item.kind) ? 'An' : 'A';
    const extra = item.default ? ` (pre-filled with “${item.default}”)` : '';
    return `${article} ${item.kind} dialog: “${item.message}”${extra}`;
  });
  const many = dialogs.length > 1;
  return [
    '',
    `${many ? 'Dialogs are open' : 'A dialog is open'}. The page does not respond until ${many ? 'they are' : 'it is'} answered: use handle_dialog (accept or not). What ${many ? 'they say' : 'it says'}:`,
    untrusted(lines.join('\n'), code),
  ].join('\n');
}

function problemLine(reading: PageReading): string[] {
  return reading.problem ? [`The page did not load: ${reading.problem}`] : [];
}

/** The address and the title of a page (and why it did not load): what the page says of itself. */
export function pageSummary(reading: PageReading, code?: string): string {
  return untrusted(
    [
      `URL: ${reading.url}`,
      `Title: ${reading.title || 'no title'}`,
      ...problemLine(reading),
    ].join('\n'),
    code,
  );
}

/** Everything a tab shows. All of it is the page's: it is one block. */
export function pageText(reading: PageReading, code?: string): string {
  const lines = [
    `URL: ${reading.url}`,
    `Title: ${reading.title}`,
    ...problemLine(reading),
    `Scrolled: ${reading.scroll}`,
    '',
  ];
  if (reading.elements.length > 0) {
    lines.push('In view (use the number as element; x, y is where it is):');
    for (const element of reading.elements) {
      const details = [
        element.name ? `${element.role} “${element.name}”` : element.role,
      ];
      if (element.value) details.push(`value “${element.value}”`);
      if (element.state) details.push(element.state);
      if (element.href) details.push(`→ ${element.href}`);
      lines.push(
        `[${element.ref}] ${details.join(', ')} at (${element.x}, ${element.y})`,
      );
    }
    lines.push('');
  }
  lines.push('Text:', reading.text || '(none)');
  return untrusted(lines.join('\n'), code);
}
