import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ImportGrant,
  ProviderTokenRefusedError,
  type ImportTokenResult,
} from './import_grant';

/** The grant sentence `resolveGraphTokenForUser` answers "reconnect" with. */
const RECONNECT =
  'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.';

const live = (token: string): ImportTokenResult => ({ success: true, token });
const reconnect: ImportTokenResult = {
  success: false,
  error: RECONNECT,
  needsReauth: true,
};

/** A file's provider calls: refused (401) for every token in `refused`. */
function providerCalls(refused: ReadonlySet<string>) {
  return vi.fn(async (token: string) => {
    if (refused.has(token)) {
      throw new ProviderTokenRefusedError('Failed to get file metadata: 401');
    }
    return `imported with ${token}`;
  });
}

/** A grant whose stored token is `stored`, and whose forced refreshes hand
 *  out `tok-2`, `tok-3`, … */
function refreshingGrant(stored = 'tok-1') {
  let minted = 1;
  const resolve = vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) =>
    forceRefresh ? live(`tok-${++minted}`) : live(stored),
  );
  return { grant: new ImportGrant(stored, resolve), resolve };
}

const forcedRefreshes = (resolve: {
  mock: { calls: Array<[{ forceRefresh: boolean }]> };
}) => resolve.mock.calls.filter(([options]) => options.forceRefresh).length;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImportGrant', () => {
  it('uses the route token as it is without a resolver (the sync engine)', async () => {
    const grant = new ImportGrant('tok-1');

    expect(await grant.beforeFile()).toBe(true);
    await expect(grant.run(async (token) => token)).resolves.toBe('tok-1');
    await expect(
      grant.run(providerCalls(new Set(['tok-1']))),
    ).rejects.toBeInstanceOf(ProviderTokenRefusedError);
    expect(grant.ended).toBeUndefined();
  });

  it('reads the grant again before each file and uses what it answers', async () => {
    const resolve = vi.fn(async () => live('tok-2'));
    const grant = new ImportGrant('tok-1', resolve);

    expect(await grant.beforeFile()).toBe(true);
    await expect(grant.run(async (token) => token)).resolves.toBe('tok-2');
    expect(resolve).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it('ends when the grant answers "reconnect", with its own sentence', async () => {
    const grant = new ImportGrant(
      'tok-1',
      vi.fn(async () => reconnect),
    );

    expect(await grant.beforeFile()).toBe(false);
    expect(grant.ended).toBe(RECONNECT);
    expect(await grant.beforeFile()).toBe(false);
  });

  it('keeps going on the token it has when a refresh is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grant = new ImportGrant(
      'tok-1',
      vi.fn(async (): Promise<ImportTokenResult> => ({
        success: false,
        error:
          'Cloud authorization could not be refreshed right now (HTTP 503) — the next sync retries',
        needsReauth: false,
      })),
    );

    expect(await grant.beforeFile()).toBe(true);
    await expect(grant.run(async (token) => token)).resolves.toBe('tok-1');
    expect(grant.ended).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  // Access removed at Google ends the access token at once, while the stored
  // expiry still counts it live: only a refresh can tell.
  it('refreshes once when the provider refuses the token, and runs the file again', async () => {
    const { grant, resolve } = refreshingGrant();
    const calls = providerCalls(new Set(['tok-1']));

    await grant.beforeFile();
    await expect(grant.run(calls)).resolves.toBe('imported with tok-2');
    expect(calls.mock.calls.map(([token]) => token)).toEqual([
      'tok-1',
      'tok-2',
    ]);
    expect(resolve).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('ends when the refresh after a refusal answers "reconnect"', async () => {
    const grant = new ImportGrant(
      'tok-1',
      vi.fn(async ({ forceRefresh }: { forceRefresh: boolean }) =>
        forceRefresh ? reconnect : live('tok-1'),
      ),
    );

    await grant.beforeFile();
    await expect(
      grant.run(providerCalls(new Set(['tok-1']))),
    ).rejects.toBeInstanceOf(ProviderTokenRefusedError);
    expect(grant.ended).toBe(RECONNECT);
    expect(await grant.beforeFile()).toBe(false);
  });

  // A provider that refuses even the token it just issued must not be asked
  // for a new one before every remaining file.
  it('refreshes again only once a file ends in something other than a refusal', async () => {
    const { grant, resolve } = refreshingGrant();
    const refusedAll = providerCalls(new Set(['tok-1', 'tok-2', 'tok-3']));

    await expect(grant.run(refusedAll)).rejects.toBeInstanceOf(
      ProviderTokenRefusedError,
    );
    await expect(grant.run(refusedAll)).rejects.toBeInstanceOf(
      ProviderTokenRefusedError,
    );
    expect(forcedRefreshes(resolve)).toBe(1);
    expect(grant.ended).toBeUndefined();

    // The provider takes `tok-2` for the next file: a later refusal may
    // refresh again.
    await expect(grant.run(async (token) => token)).resolves.toBe('tok-2');
    await expect(grant.run(providerCalls(new Set(['tok-2'])))).resolves.toBe(
      'imported with tok-3',
    );
    expect(forcedRefreshes(resolve)).toBe(2);
  });

  it('does not refresh for a failure that is not a refused token', async () => {
    const { grant, resolve } = refreshingGrant();

    await expect(
      grant.run(async () => {
        throw new Error('Failed to download file: 503');
      }),
    ).rejects.toThrow('503');
    expect(resolve).not.toHaveBeenCalled();
  });

  // A read that throws — a database blip, a token endpoint that did not
  // answer — used to reject the whole import after the files it had done.
  it('keeps going when reading the grant throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grant = new ImportGrant(
      'tok-1',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    expect(await grant.beforeFile()).toBe(true);
    await expect(grant.run(async (token) => token)).resolves.toBe('tok-1');
    expect(grant.ended).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fetch failed'));
  });

  // A throttled token endpoint must not be asked again before every file.
  it('leaves a grant that could not be read alone for a while', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 1_000;
    const resolve = vi.fn(async (): Promise<ImportTokenResult> => ({
      success: false,
      error:
        'Cloud authorization could not be refreshed right now (HTTP 429) — the next sync retries',
      needsReauth: false,
    }));
    const grant = new ImportGrant('tok-1', resolve, () => clock);

    for (let file = 0; file < 5; file++) {
      expect(await grant.beforeFile()).toBe(true);
      clock += 1_000;
    }
    expect(resolve).toHaveBeenCalledTimes(1);

    clock += 30_000;
    await grant.beforeFile();
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  // One token-endpoint blip while access was being removed must not leave
  // every later file failing on a refused token.
  it('asks for a new token again once the quiet window has passed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 1_000;
    let endpointUp = false;
    const resolve = vi.fn(
      async ({
        forceRefresh,
      }: {
        forceRefresh: boolean;
      }): Promise<ImportTokenResult> => {
        if (!forceRefresh) return live('tok-1');
        return endpointUp
          ? reconnect
          : { success: false, error: 'HTTP 503', needsReauth: false };
      },
    );
    const grant = new ImportGrant('tok-1', resolve, () => clock);
    const refused = providerCalls(new Set(['tok-1']));

    await expect(grant.run(refused)).rejects.toBeInstanceOf(
      ProviderTokenRefusedError,
    );
    clock += 5_000;
    await expect(grant.run(refused)).rejects.toBeInstanceOf(
      ProviderTokenRefusedError,
    );
    expect(forcedRefreshes(resolve)).toBe(1);

    clock += 30_000;
    endpointUp = true;
    await expect(grant.run(refused)).rejects.toBeInstanceOf(
      ProviderTokenRefusedError,
    );
    expect(forcedRefreshes(resolve)).toBe(2);
    expect(grant.ended).toBe(RECONNECT);
  });
});
