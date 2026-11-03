import { describe, expect, it, vi } from 'vitest';

import { metaSchema } from '../../../lib/api/schemas.ts';
import { meta } from '../../../tests/utils/fixtures.ts';
import { expectJson, stubbedApi } from '../../testing/api-client.ts';

describe('GET /api/meta', () => {
  it('answers what the manager says of the app and its counts', async () => {
    const overview = meta({
      browserInstalled: false,
      browserInstalling: true,
      nextSessionName: '0003',
      counts: { proxies: 2, freeProxies: 1, failedProxies: 1, secrets: 4 },
    });
    const metaOf = vi.fn(() => overview);
    const { client } = stubbedApi({ meta: metaOf });

    const response = await client.get('/api/meta');

    expect(await expectJson(response, 200, metaSchema)).toEqual(overview);
    expect(metaOf).toHaveBeenCalledOnce();
  });

  it('is the camelCase of the contract, never the snake_case of the old app', async () => {
    const { client } = stubbedApi({ meta: () => meta() });
    const body = await (await client.get('/api/meta')).json();
    expect(Object.keys(body)).toContain('browserInstalled');
    expect(Object.keys(body.counts)).toContain('freeProxies');
    expect(JSON.stringify(body)).not.toMatch(/_/);
  });
});
