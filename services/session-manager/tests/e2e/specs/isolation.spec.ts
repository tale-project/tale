import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

import { sessionSchema, type Session } from '../../../lib/api/schemas';
import { PLAN } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { peersOf } from '../helpers/peers';
import type { E2eServerAddress } from '../servers.ts';

// The suite runs one isolated server per worker (`tests/e2e/launcher.ts`).
// These specs hold the isolation itself while the other workers are busy on
// theirs: a worker's pages, requests and fakes all belong to its own server,
// and nothing it makes reaches another. They only LOOK at the other servers.

/** The sessions a server holds, asked by address so that it can be any server. */
async function sessionsOn(
  request: APIRequestContext,
  address: E2eServerAddress,
): Promise<Session[]> {
  const response = await request.get(
    `${address.origin}/api/sessions?limit=500`,
  );
  expect(response.ok(), `GET /api/sessions on server ${address.index}`).toBe(
    true,
  );
  return z.array(sessionSchema).parse(await response.json());
}

// A name no other worker, run or repeat uses.
const uniqueName = (index: number) => `iso-${index}-${Date.now()}`;

test.describe('One server per worker', () => {
  test('the page, the request fixture and the fakes of a worker all belong to its own server', async ({
    page,
    request,
    api,
    control,
    server,
    baseURL,
  }, testInfo) => {
    expect(server.index).toBe(testInfo.parallelIndex);
    expect(server.origin).toBe(`http://localhost:${server.port}`);
    // Relative addresses lead to the worker's server, or to the dev server in
    // front of the one server there is (`E2E_BASE_URL`).
    expect(baseURL).toBe(PLAN.baseUrl ?? server.origin);

    const name = uniqueName(server.index);
    const session = await api.startSession(name);

    // `request` and `api` go where a relative address leads: to the same server
    // as an absolute address of the worker's own.
    const own = await sessionsOn(request, server);
    expect(own.map((one) => one.id)).toEqual([session.id]);

    // The page opens at the same one.
    await page.goto('/sessions');
    expect(new URL(page.url()).origin).toBe(
      new URL(baseURL ?? server.origin).origin,
    );
    await expect(
      page.getByRole('link', { name: new RegExp(`\\b${name}\\b`) }),
    ).toBeVisible();

    // And so does the control server of the fakes.
    expect((await control.browser(name)).closed).toBe(false);
  });

  test('what a worker makes is on no other server, and no other worker makes anything on its own', async ({
    request,
    api,
    control,
    server,
  }) => {
    const name = uniqueName(server.index);
    await api.startSession(name);
    await control.openDialog(name, { message: name });

    // Reset at the start, so everything on this server is this test's: a
    // session of another worker here would be a server two workers share.
    expect((await sessionsOn(request, server)).map((one) => one.name)).toEqual([
      name,
    ]);

    for (const peer of peersOf(server)) {
      const label = `server ${peer.index}`;
      expect(
        (await sessionsOn(request, peer)).map((one) => one.name),
        label,
      ).not.toContain(name);
      // The fake browser, and the dialog its page opened, are on this worker's
      // control server only.
      const browser = await request.get(
        `${peer.controlUrl}/browsers/${encodeURIComponent(name)}`,
      );
      expect(browser.status(), `${label}: the control server`).toBe(404);
    }
  });
});
