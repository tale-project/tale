import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/app/lib/api/keys';
import { secretSummary, session } from '@/tests/utils/fixtures';

import {
  readSecretsOfSession,
  readSession,
  removalOf,
  REMOVE_SESSION_KEY,
} from './removal';

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** A deletion of session `id` that ends when `finish` or `fail` is called. */
function deletion(client: QueryClient, id: number) {
  let finish: () => void = () => {};
  let fail: () => void = () => {};
  const gate = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = () => reject(new Error('refused'));
  });
  const observer = new MutationObserver(client, {
    mutationKey: REMOVE_SESSION_KEY,
    mutationFn: (_variables: { id: number }) => gate,
  });
  // Settles with the deletion: a refused one rejects.
  const done = observer.mutate({ id });
  return { finish, fail, done };
}

describe('removalOf', () => {
  it('says that nothing is going on for a session nobody is deleting', () => {
    const client = newClient();
    expect(removalOf(client, 4)).toBe('none');
  });

  it('follows the deletion of that session: under way, then done', async () => {
    const client = newClient();
    const removing = deletion(client, 4);

    expect(removalOf(client, 4)).toBe('pending');
    expect(removalOf(client, 5)).toBe('none');
    removing.finish();
    await removing.done;
    expect(removalOf(client, 4)).toBe('done');
    expect(removalOf(client, 5)).toBe('none');
  });

  it('forgets a deletion the backend refused: the session is still there', async () => {
    const client = newClient();
    const removing = deletion(client, 4);
    removing.fail();
    await expect(removing.done).rejects.toThrow('refused');
    expect(removalOf(client, 4)).toBe('none');
  });

  it('does not take any other write of the app for a deletion', async () => {
    const client = newClient();
    const other = new MutationObserver(client, {
      mutationKey: ['sessions', 'stop'],
      mutationFn: (_variables: { id: number }) => new Promise<void>(() => {}),
    });
    void other.mutate({ id: 4 });
    expect(removalOf(client, 4)).toBe('none');
  });
});

describe('readSession', () => {
  const read = (client: QueryClient, ask: () => Promise<unknown>) =>
    readSession(client, 4, () => ask().then(() => session({ id: 4 })));

  it('asks for the session when nobody is deleting it', async () => {
    const client = newClient();
    let asked = 0;
    const found = await read(client, async () => {
      asked += 1;
    });
    expect(found.id).toBe(4);
    expect(asked).toBe(1);
  });

  it('asks for nothing while it is being deleted, and answers with what was read before', async () => {
    const client = newClient();
    client.setQueryData(queryKeys.session(4), session({ id: 4, name: 'Shop' }));
    deletion(client, 4);
    let asked = 0;
    const found = await read(client, async () => {
      asked += 1;
    });
    expect(asked).toBe(0);
    expect(found.name).toBe('Shop');
  });

  it('says it is gone, without asking, once it was deleted', async () => {
    const client = newClient();
    client.setQueryData(queryKeys.session(4), session({ id: 4 }));
    const removing = deletion(client, 4);
    removing.finish();
    await removing.done;
    let asked = 0;

    await expect(
      read(client, async () => {
        asked += 1;
      }),
    ).rejects.toMatchObject({ status: 404, code: 'session_not_found' });
    expect(asked).toBe(0);
  });

  it('says it is gone when it is being deleted and nothing was read of it', async () => {
    const client = newClient();
    deletion(client, 4);
    await expect(read(client, async () => {})).rejects.toMatchObject({
      status: 404,
      code: 'session_not_found',
    });
  });
});

describe('readSecretsOfSession', () => {
  const key = queryKeys.secretList({ scope: '4' });

  it('asks for the secrets when nobody is deleting the session', async () => {
    const client = newClient();
    const found = await readSecretsOfSession(client, 4, async () => [
      secretSummary({ id: 1 }),
    ]);
    expect(found).toHaveLength(1);
  });

  it('asks for nothing once the session is going away, and answers with the count it knew', async () => {
    const client = newClient();
    client.setQueryData(key, [
      secretSummary({ id: 1 }),
      secretSummary({ id: 2 }),
    ]);
    deletion(client, 4);
    let asked = 0;

    const found = await readSecretsOfSession(client, 4, async () => {
      asked += 1;
      return [];
    });

    expect(asked).toBe(0);
    expect(found).toHaveLength(2);
  });

  it('answers with none when it knew none', async () => {
    const client = newClient();
    deletion(client, 4);
    expect(await readSecretsOfSession(client, 4, async () => [])).toEqual([]);
  });
});
