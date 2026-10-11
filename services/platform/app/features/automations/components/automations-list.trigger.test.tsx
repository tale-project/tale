// @vitest-environment jsdom
/**
 * The Trigger column over the real listing read (#4019): `useAutomations`,
 * the adapter row and `backendFetch` run unchanged, and only `fetch` is
 * answered here, as the listing door answers it. Each row says, apart from
 * its deployed version, whether its trigger starts runs on its own — in
 * every shipped language — and the column never guesses: a row the door
 * said nothing about reads unknown, a read in flight shows no word, and a
 * failed read shows the failure. The `automation` hint that saving a
 * trigger and a schedule's automatic pause both emit refreshes the column
 * without a reload.
 */
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendHints } from '@/app/lib/backend/use-backend-hints';
import {
  forgetSavedLocale,
  saveLocale,
  SHIPPED_LOCALES,
  type ShippedLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor, within } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { AutomationsList } from './automations-list';

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjects: () => ({ projects: [], isLoading: false }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-1' }),
  useLocation: () => ({ pathname: '/dashboard/org-1/automations' }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@/app/hooks/use-preload-route', () => ({
  usePreloadRoute: () => vi.fn(),
}));

vi.mock('./automation-row-actions', () => ({
  AutomationRowActions: () => null,
}));

const ORG = 'org-1';
const LISTING = /^GET \/api\/app\/automations\/listing\?/;

type WireTrigger = {
  kind: 'schedule' | 'webhook' | 'event';
  enabled: boolean;
  lastSkipReason: string | null;
} | null;

/** A listing row as the door sends it; `trigger` left out when `absent`. */
function wireRow(
  name: string,
  displayName: string,
  deployedVersion: number | undefined,
  trigger: WireTrigger | 'absent',
) {
  return {
    name,
    latest: 3,
    projectIds: [],
    ...(deployedVersion !== undefined && { deployedVersion }),
    presentation: { name: displayName },
    ...(trigger !== 'absent' && { trigger }),
  };
}

const PAUSED: WireTrigger = {
  kind: 'schedule',
  enabled: false,
  lastSkipReason: 'paused_after_failures',
};

const ROWS = [
  wireRow('ops/digest', 'Morning digest', 3, {
    kind: 'schedule',
    enabled: true,
    lastSkipReason: null,
  }),
  wireRow('ops/nightly', 'Nightly export', 1, PAUSED),
  wireRow('ops/intake', 'Intake hook', 2, {
    kind: 'webhook',
    enabled: false,
    lastSkipReason: null,
  }),
  wireRow('ops/draft', 'Event draft', undefined, {
    kind: 'event',
    enabled: true,
    lastSkipReason: null,
  }),
  wireRow('ops/by-hand', 'Run by hand', 1, null),
  wireRow('ops/older', 'Older server row', 1, 'absent'),
];

/** The words each shipped language reads in the Status and Trigger cells. */
const COPY: Record<
  ShippedLocale,
  {
    status: string;
    trigger: string;
    live: (version: number) => string;
    notDeployed: string;
    on: string;
    paused: string;
    off: string;
    notLive: string;
    manual: string;
    manualHow: string;
    unknown: string;
    schedule: string;
    webhook: string;
    event: string;
  }
> = {
  en: {
    status: 'Status',
    trigger: 'Trigger',
    live: (version) => `Live: v${version}`,
    notDeployed: 'Not deployed',
    on: 'Enabled',
    paused: 'Paused',
    off: 'Off',
    notLive: 'Not live',
    manual: 'Manual',
    manualHow: 'By hand, API or MCP',
    unknown: 'Unknown',
    schedule: 'Schedule',
    webhook: 'Webhook',
    event: 'Platform event',
  },
  de: {
    status: 'Status',
    trigger: 'Trigger',
    live: (version) => `Live: v${version}`,
    notDeployed: 'Nicht live',
    on: 'Aktiv',
    paused: 'Pausiert',
    off: 'Aus',
    notLive: 'Nicht live',
    manual: 'Manuell',
    manualHow: 'Von Hand, API oder MCP',
    unknown: 'Unbekannt',
    schedule: 'Zeitplan',
    webhook: 'Webhook',
    event: 'Plattform-Ereignis',
  },
  fr: {
    status: 'Statut',
    trigger: 'Déclencheur',
    live: (version) => `En service : v${version}`,
    notDeployed: 'Pas en service',
    on: 'Actif',
    paused: 'En pause',
    off: 'Désactivé',
    notLive: 'Pas en service',
    manual: 'Manuel',
    manualHow: 'À la main, API ou MCP',
    unknown: 'Inconnu',
    schedule: 'Planification',
    webhook: 'Webhook',
    event: 'Événement de la plateforme',
  },
};

/** Text as a reader sees it: `Intl`/French spacing folded to one space. */
const words = (text: string | null | undefined) =>
  (text ?? '').replace(/\s+/gu, ' ').trim();

/** A controllable EventSource double: the test sends the stream's hints. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = 1;
  private readonly listeners = new Map<
    string,
    Set<(event: MessageEvent<string>) => void>
  >();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = 2;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent<string>(type, { data }));
    }
  }
}

/** The dashboard's realtime bridge, mounted beside the list as the
 * organization shell mounts it. */
function Hints() {
  useBackendHints(ORG);
  return null;
}

let backend: SyntheticBackend;

beforeEach(() => {
  // The adapters resolve the active organization from the page's address.
  window.history.pushState({}, '', `/dashboard/${ORG}/automations`);
  window.__ENV__ = { BASE_PATH: '' };
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  backend = syntheticBackend();
  backend.on(LISTING, () => Response.json({ automations: ROWS }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete window.__ENV__;
  await forgetSavedLocale();
});

function renderList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Hints />
      <AutomationsList organizationId={ORG} />
    </QueryClientProvider>,
  );
}

/** Each piece of text `element` shows, in reading order. */
function pieces(element: Element): string[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = words(node.textContent);
    if (text !== '') found.push(text);
  }
  return found;
}

/** The Status words and the Trigger cell's pieces (the state, then the
 * kind) of the row its name links from. */
function cellsOf(displayName: string, copy: (typeof COPY)[ShippedLocale]) {
  const headers = screen
    .getAllByRole('columnheader')
    .map((header) => words(header.textContent));
  const row = screen.getByRole('link', { name: displayName }).closest('tr');
  if (row === null) throw new Error(`no row for ${displayName}`);
  const cells = within(row).getAllByRole('cell');
  const status = cells[headers.indexOf(copy.status)];
  const trigger = cells[headers.indexOf(copy.trigger)];
  if (status === undefined || trigger === undefined) {
    throw new Error(`no Status or Trigger cell for ${displayName}`);
  }
  return { status: words(status.textContent), trigger: pieces(trigger) };
}

describe.each(SHIPPED_LOCALES)('the Trigger column in %s', (locale) => {
  const copy = COPY[locale];

  it('says beside each deployed version whether its trigger starts runs', async () => {
    saveLocale(locale);
    renderList();
    expect(
      await screen.findByRole('link', { name: 'Morning digest' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: copy.trigger }),
    ).toBeInTheDocument();

    expect(cellsOf('Morning digest', copy)).toEqual({
      status: copy.live(3),
      trigger: [copy.on, copy.schedule],
    });
    // Live, yet its schedule starts nothing: the two never fold into one.
    expect(cellsOf('Nightly export', copy)).toEqual({
      status: copy.live(1),
      trigger: [copy.paused, copy.schedule],
    });
    expect(cellsOf('Intake hook', copy)).toEqual({
      status: copy.live(2),
      trigger: [copy.off, copy.webhook],
    });
    expect(cellsOf('Event draft', copy)).toEqual({
      status: copy.notDeployed,
      trigger: [copy.notLive, copy.event],
    });
    // No trigger is how it runs, not a fault: by hand, the API or MCP.
    expect(cellsOf('Run by hand', copy)).toEqual({
      status: copy.live(1),
      trigger: [copy.manual, copy.manualHow],
    });
  });

  it('reads a row the door said nothing about as unknown, never as by hand', async () => {
    saveLocale(locale);
    renderList();
    await screen.findByRole('link', { name: 'Older server row' });
    expect(cellsOf('Older server row', copy)).toEqual({
      status: copy.live(1),
      trigger: [copy.unknown],
    });
  });
});

describe('the Trigger column never guesses', () => {
  const copy = COPY.en;
  const anyTriggerWord = new RegExp(
    `^(${[
      copy.on,
      copy.paused,
      copy.off,
      copy.notLive,
      copy.manual,
      copy.manualHow,
      copy.unknown,
      copy.schedule,
      copy.webhook,
      copy.event,
    ].join('|')})$`,
  );

  it('shows no state while the listing is still on its way', async () => {
    backend.on(LISTING, () => new Promise<Response>(() => {}));
    renderList();
    await waitFor(() => expect(backend.count(LISTING)).toBe(1));
    expect(
      screen.getByRole('columnheader', { name: copy.trigger }),
    ).toBeInTheDocument();
    expect(screen.queryByText(anyTriggerWord)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows the failure, and no state, when the listing cannot be read', async () => {
    backend.on(LISTING, () => serviceUnavailable());
    renderList();
    expect(
      await screen.findByText(/Couldn't load automations/),
    ).toBeInTheDocument();
    expect(screen.queryByText(anyTriggerWord)).not.toBeInTheDocument();
  });
});

describe('the Trigger column stays current', () => {
  const copy = COPY.en;

  it('follows an automatic pause and a saved trigger through the automation hint', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Morning digest' });
    expect(cellsOf('Morning digest', copy).trigger).toEqual([
      copy.on,
      copy.schedule,
    ]);
    const readsBefore = backend.count(LISTING);

    // The schedule's fifth failure in a row pauses it, and the run's landing
    // emits the automation's definition hint (`finishRun`).
    backend.on(LISTING, () =>
      Response.json({
        automations: ROWS.map((row) =>
          row.name === 'ops/digest' ? { ...row, trigger: PAUSED } : row,
        ),
      }),
    );
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'automation', entityId: 'ops/digest' }),
      );
    });
    await waitFor(() =>
      expect(cellsOf('Morning digest', copy)).toEqual({
        status: copy.live(3),
        trigger: [copy.paused, copy.schedule],
      }),
    );
    expect(backend.count(LISTING)).toBe(readsBefore + 1);

    // Someone fixes it, turns the schedule back on and saves (`setTrigger`
    // emits the same hint), in this session or another.
    backend.on(LISTING, () => Response.json({ automations: ROWS }));
    act(() => {
      FakeEventSource.instances[0]?.emit(
        'hint',
        JSON.stringify({ entity: 'automation', entityId: 'ops/digest' }),
      );
    });
    await waitFor(() =>
      expect(cellsOf('Morning digest', copy).trigger).toEqual([
        copy.on,
        copy.schedule,
      ]),
    );
  });
});
