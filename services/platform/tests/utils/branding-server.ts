import { vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';

/**
 * The organization branding door as the server answers it, behind a mocked
 * `backendFetch` (`vi.mock('@/app/lib/backend/api-client', …)` in the test):
 * one stored config and its version, the compare-and-set a write sent with
 * `expectedHash` meets — 409 `CONFIG_VERSION_CONFLICT`, nothing stored — image
 * writes that record their reference and answer the versions they moved
 * between, and a Save that replaces the whole config (BRAND-R2, -R3, -R6).
 * `hold` keeps a request from being applied, and optionally its answer from
 * reaching the page, so every order of commits and answers can be played,
 * including a write the page saw fail that the server still applies later;
 * `elsewhere` writes as another session of the organization does.
 */

export type Stored = Record<string, string>;

const FIELD = {
  logo: 'logoFilename',
  'favicon-light': 'faviconLightFilename',
  'favicon-dark': 'faviconDarkFilename',
} as const;

type ImageType = keyof typeof FIELD;

export interface SentRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface Hold {
  /** The request, once it has reached the server. */
  arrived: Promise<SentRequest>;
  /** Lets the server apply the request; resolves with what it did. */
  commit: () => Promise<'applied' | 'refused'>;
  /** Lets its answer reach the page, when the answer was held too. */
  answer: () => void;
  /** Fails the page's request as a lost connection now; the server still
   * applies the request once it is committed. */
  loseAnswer: () => void;
  /** Answers the request with `error` instead of applying it. */
  refuse: (error: unknown) => void;
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A version that changes with the stored content, as the server's SHA-256
 * of the file does; `null` while there is no branding file. */
function versionOf(stored: Stored | null): string | null {
  if (stored === null) return null;
  const entries = Object.entries(stored).sort(([a], [b]) => a.localeCompare(b));
  return `v:${JSON.stringify(entries)}`;
}

export function brandingServer(initial: Stored | null) {
  let stored: Stored | null = initial === null ? null : { ...initial };
  const log: string[] = [];
  // The bytes of each stored image, served back as a data URL, so a page in
  // a real browser shows what was stored.
  const images = new Map<string, string>();
  const holds: {
    key: string;
    taken: boolean;
    arrived: ReturnType<typeof deferred<SentRequest>>;
    commit: ReturnType<typeof deferred>;
    answer: ReturnType<typeof deferred>;
    lost: ReturnType<typeof deferred>;
    refusal?: { error: unknown };
    outcome?: Promise<
      { ok: true; value: unknown } | { ok: false; error: unknown }
    >;
  }[] = [];

  const view = () => {
    const at = (field: string) => {
      const filename = stored?.[field];
      if (!filename) return null;
      return images.get(filename) ?? `/branding/org/${filename}`;
    };
    return {
      ...(stored?.accentColor ? { accentColor: stored.accentColor } : {}),
      logoUrl: at('logoFilename'),
      faviconLightUrl: at('faviconLightFilename'),
      faviconDarkUrl: at('faviconDarkFilename'),
      ...(stored?.logoFilename ? { logoFilename: stored.logoFilename } : {}),
      ...(stored?.faviconLightFilename
        ? { faviconLightFilename: stored.faviconLightFilename }
        : {}),
      ...(stored?.faviconDarkFilename
        ? { faviconDarkFilename: stored.faviconDarkFilename }
        : {}),
      hash: versionOf(stored) ?? '',
    };
  };

  function checkVersion(
    body: Record<string, unknown> | undefined,
    what: string,
  ) {
    if (body?.expectedHash === undefined) return;
    if (body.expectedHash !== versionOf(stored)) {
      log.push(`${what} refused`);
      throw new BackendApiError(
        409,
        'Configuration changed since it was reviewed. Read the current value and plan again.',
        'CONFIG_VERSION_CONFLICT',
      );
    }
  }

  function writeImage(type: ImageType, filename: string | undefined) {
    const previousHash = versionOf(stored);
    const next: Stored = { ...stored };
    delete next[FIELD[type]];
    if (filename !== undefined) next[FIELD[type]] = filename;
    stored = next;
    return { hash: versionOf(stored), previousHash };
  }

  function apply(request: SentRequest): unknown {
    const { method, path, body } = request;
    if (method === 'GET' && path === '/branding') return view();
    if (method === 'POST' && path === '/branding/snapshot') {
      return { snapshot: null };
    }
    if (method === 'POST' && path === '/branding/save') {
      const what = `save ${String(body?.accentColor ?? 'cleared')}`;
      checkVersion(body, what);
      const next: Stored = {};
      for (const [key, value] of Object.entries(body ?? {})) {
        if (key !== 'expectedHash' && typeof value === 'string') {
          next[key] = value;
        }
      }
      stored = next;
      log.push(what);
      return { hash: versionOf(stored) };
    }
    if (method === 'POST' && path === '/branding/images') {
      const type = String(body?.type) as ImageType;
      const ext = body?.mimeType === 'image/png' ? 'png' : 'svg';
      const filename = `${type}.${ext}`;
      const what = `upload ${filename}`;
      checkVersion(body, what);
      log.push(what);
      images.set(
        filename,
        `data:${String(body?.mimeType)};base64,${String(body?.base64)}`,
      );
      return { filename, ...writeImage(type, filename) };
    }
    if (method === 'DELETE' && path.startsWith('/branding/images/')) {
      const type = path.slice('/branding/images/'.length) as ImageType;
      log.push(`delete ${type}`);
      return { ok: true, ...writeImage(type, undefined) };
    }
    throw new Error(`unexpected ${method} ${path}`);
  }

  const LOST = Symbol('lost');

  vi.mocked(backendFetch).mockImplementation(async (path, options) => {
    const method =
      options?.method ?? (options?.body !== undefined ? 'POST' : 'GET');
    const body =
      options?.body !== undefined && typeof options.body === 'object'
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the adapters send JSON objects
          (options.body as Record<string, unknown>)
        : undefined;
    const request: SentRequest = { method, path, body };
    const held = holds.find(
      (hold) => !hold.taken && hold.key === `${method} ${path}`,
    );
    if (held === undefined) return apply(request);
    held.taken = true;
    held.arrived.resolve(request);
    const outcome = held.commit.promise.then(() => {
      if (held.refusal !== undefined) {
        return { ok: false as const, error: held.refusal.error };
      }
      try {
        return { ok: true as const, value: apply(request) };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    held.outcome = outcome;
    const answered = outcome.then(async (settled) => {
      await held.answer.promise;
      return settled;
    });
    const first = await Promise.race([
      held.lost.promise.then(() => LOST),
      answered,
    ]);
    if (first === LOST) throw new TypeError('Failed to fetch');
    if (first.ok) return first.value;
    throw first.error;
  });

  return {
    log,
    stored: () => stored,
    /** The stored image's bytes as a data URL, when the page uploaded it. */
    image: (filename: string) => images.get(filename),
    version: () => versionOf(stored),
    /** Holds the next `METHOD /path` request before the server applies it;
     * with `answer`, its answer is held after that too. */
    hold(key: string, options: { answer?: boolean } = {}): Hold {
      const entry: (typeof holds)[number] = {
        key,
        taken: false,
        arrived: deferred<SentRequest>(),
        commit: deferred(),
        answer: deferred(),
        lost: deferred(),
      };
      if (!options.answer) entry.answer.resolve();
      holds.push(entry);
      return {
        arrived: entry.arrived.promise,
        commit: async () => {
          await entry.arrived.promise;
          entry.commit.resolve();
          const settled = await entry.outcome;
          return settled?.ok ? 'applied' : 'refused';
        },
        answer: () => entry.answer.resolve(),
        loseAnswer: () => entry.lost.resolve(),
        refuse: (error) => {
          entry.refusal = { error };
          entry.commit.resolve();
        },
      };
    },
    /** What another session of the organization saves or uploads. */
    elsewhere: {
      save(next: Stored) {
        stored = { ...next };
        log.push('elsewhere save');
      },
      upload(type: ImageType, filename: string, dataUrl?: string) {
        writeImage(type, filename);
        if (dataUrl !== undefined) images.set(filename, dataUrl);
        log.push(`elsewhere upload ${filename}`);
      },
      reset() {
        stored = {};
        log.push('elsewhere reset');
      },
    },
  };
}

export type BrandingServer = ReturnType<typeof brandingServer>;
