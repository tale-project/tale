import { z } from 'zod';

import {
  importResultSchema,
  metaSchema,
  proxyExportSchema,
  proxySchema,
  secretSchema,
  secretSummarySchema,
  sessionSchema,
  settingsSchema,
  type ImportResult,
  type Meta,
  type Proxy,
  type ProxyCreate,
  type ProxyImport,
  type Scheme,
  type Secret,
  type SecretCreate,
  type SecretKind,
  type SecretSummary,
  type SecretUpdate,
  type Session,
  type SessionCreate,
  type Settings,
  type SettingsUpdate,
} from '@/lib/api/schemas';

import {
  apiJson,
  apiList,
  apiVoid,
  type ListResult,
  type RequestOptions,
} from './client';

/**
 * The window of a list a page asks for: the newest `limit` rows, and with
 * `minId` none older than that id (the rows from it up).
 */
export interface ListWindow {
  limit: number;
  minId?: number;
}

/** The most rows the server answers with in one request (`pageQuerySchema`). */
export const MAX_PAGE = 500;

/**
 * The newest `limit` rows of a list, in as many requests as the server's page
 * size makes necessary. A list can be far larger than one page (a provider's
 * export is a thousand proxies); past the first page the next ones are asked
 * for by the id they start below (`before`), which also keeps them from
 * overlapping when rows are added meanwhile. A page that comes back short is
 * the end: of the list, or of the rows from `minId` up.
 */
async function listWindow<S extends z.ZodType<{ id: number }>>(
  itemSchema: S,
  path: string,
  { limit, minId }: ListWindow,
  options: RequestOptions = {},
): Promise<ListResult<z.output<S>>> {
  const bound = minId === undefined ? {} : { minId };
  let asked = Math.min(limit, MAX_PAGE);
  const first = await apiList(itemSchema, path, {
    ...options,
    query: { limit: asked, ...bound },
  });
  const items = [...first.items];
  let page = first.items;
  while (items.length < limit && page.length === asked) {
    const last = items.at(-1);
    if (last === undefined) break;
    asked = Math.min(limit - items.length, MAX_PAGE);
    ({ items: page } = await apiList(itemSchema, path, {
      ...options,
      query: { limit: asked, before: last.id, ...bound },
    }));
    items.push(...page);
  }
  return { items, total: first.total };
}

const idPath = (base: string, id: number) => `${base}/${id}`;

export const metaApi = {
  get: (options?: RequestOptions): Promise<Meta> =>
    apiJson(metaSchema, 'GET', '/meta', options),
};

export const settingsApi = {
  get: (options?: RequestOptions): Promise<Settings> =>
    apiJson(settingsSchema, 'GET', '/settings', options),
  update: (update: SettingsUpdate): Promise<Settings> =>
    apiJson(settingsSchema, 'PATCH', '/settings', { body: update }),
};

export const sessionsApi = {
  list: (
    window: ListWindow,
    options?: RequestOptions,
  ): Promise<ListResult<Session>> =>
    listWindow(sessionSchema, '/sessions', window, options),
  get: (id: number, options?: RequestOptions): Promise<Session> =>
    apiJson(sessionSchema, 'GET', idPath('/sessions', id), options),
  create: (input: Partial<SessionCreate>): Promise<Session> =>
    apiJson(sessionSchema, 'POST', '/sessions', { body: input }),
  rename: (id: number, name: string): Promise<Session> =>
    apiJson(sessionSchema, 'PATCH', idPath('/sessions', id), {
      body: { name },
    }),
  start: (id: number, force = false): Promise<Session> =>
    apiJson(sessionSchema, 'POST', `${idPath('/sessions', id)}/start`, {
      body: { force },
    }),
  stop: (id: number): Promise<Session> =>
    apiJson(sessionSchema, 'POST', `${idPath('/sessions', id)}/stop`),
  restart: (id: number): Promise<Session> =>
    apiJson(sessionSchema, 'POST', `${idPath('/sessions', id)}/restart`),
  rotate: (id: number): Promise<Session> =>
    apiJson(sessionSchema, 'POST', `${idPath('/sessions', id)}/rotate`),
  checkIp: (id: number): Promise<Session> =>
    apiJson(sessionSchema, 'POST', `${idPath('/sessions', id)}/check-ip`),
  remove: (id: number): Promise<void> =>
    apiVoid('DELETE', idPath('/sessions', id)),
  /** The proxy file of the sessions (with passwords). */
  exportProxies: (): Promise<z.output<typeof proxyExportSchema>> =>
    apiJson(proxyExportSchema, 'GET', '/sessions/export-proxies'),
};

export const proxiesApi = {
  list: (
    window: ListWindow,
    options?: RequestOptions,
  ): Promise<ListResult<Proxy>> =>
    listWindow(proxySchema, '/proxies', window, options),
  add: (proxy: string, defaultScheme: Scheme): Promise<Proxy> => {
    const body: ProxyCreate = { proxy, defaultScheme };
    return apiJson(proxySchema, 'POST', '/proxies', { body });
  },
  import: (text: string, defaultScheme: Scheme): Promise<ImportResult> => {
    const body: ProxyImport = { text, defaultScheme };
    return apiJson(importResultSchema, 'POST', '/proxies/import', { body });
  },
  check: (id: number): Promise<Proxy> =>
    apiJson(proxySchema, 'POST', `${idPath('/proxies', id)}/check`),
  checkAll: (): Promise<Proxy[]> =>
    apiJson(z.array(proxySchema), 'POST', '/proxies/check-all'),
  remove: (id: number, force = false): Promise<void> =>
    apiVoid('DELETE', idPath('/proxies', id), { query: { force } }),
};

export interface SecretsFilter {
  kind?: SecretKind | null;
  /** `all`, `global` or a session's id as text. */
  scope?: string;
  includeGlobal?: boolean;
}

export const secretsApi = {
  list: (
    filter: SecretsFilter = {},
    options?: RequestOptions,
  ): Promise<SecretSummary[]> =>
    apiJson(z.array(secretSummarySchema), 'GET', '/secrets', {
      ...options,
      query: {
        kind: filter.kind ?? undefined,
        scope: filter.scope,
        includeGlobal: filter.includeGlobal,
      },
    }),
  get: (id: number): Promise<Secret> =>
    apiJson(secretSchema, 'GET', idPath('/secrets', id)),
  create: (input: SecretCreate): Promise<Secret> =>
    apiJson(secretSchema, 'POST', '/secrets', { body: input }),
  update: (id: number, update: SecretUpdate): Promise<Secret> =>
    apiJson(secretSchema, 'PATCH', idPath('/secrets', id), { body: update }),
  remove: (id: number): Promise<void> =>
    apiVoid('DELETE', idPath('/secrets', id)),
};
