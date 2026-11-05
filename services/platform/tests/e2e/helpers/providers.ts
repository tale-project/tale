import { readFileSync } from 'node:fs';

import { expect, type APIRequestContext } from '@playwright/test';
import { parse } from 'yaml';
import { z } from 'zod';

import { BASE_URL } from './env';

/**
 * The mock LLM as the organization's AI provider: its definition — the
 * tracked `fixtures/config/default/providers/e2e-mock.yml`, saved through
 * the providers API the settings dialog uses — and an env credential naming
 * `TALE_PROVIDER_KEY_E2E_MOCK`, which the E2E stack sets. A new organization
 * lists no model until both exist, so a spec whose page chats calls this
 * first. Idempotent: an organization that already has the credential is
 * left as it is.
 */

const PROVIDER = 'e2e-mock';
const CREDENTIAL = 'E2E mock gateway';

const definition: unknown = parse(
  readFileSync(
    new URL(
      '../fixtures/config/default/providers/e2e-mock.yml',
      import.meta.url,
    ),
    'utf8',
  ),
);

const credentialsSchema = z.object({
  credentials: z.array(z.looseObject({ providerSlug: z.string() })),
});

export async function connectMockProvider(
  request: APIRequestContext,
  organizationId: string,
): Promise<void> {
  const query = `orgId=${encodeURIComponent(organizationId)}`;
  const headers = { origin: BASE_URL };
  const listed = credentialsSchema.parse(
    await (
      await request.get(`/api/app/provider-credentials?${query}`, { headers })
    ).json(),
  );
  if (listed.credentials.some((row) => row.providerSlug === PROVIDER)) return;

  const saved = await request.put(
    `/api/app/providers/definitions/${PROVIDER}?${query}`,
    { headers, data: { config: definition, expectedHash: null } },
  );
  expect(saved.status(), await saved.text()).toBe(200);
  const credential = await request.post(
    `/api/app/provider-credentials?${query}`,
    {
      headers,
      data: {
        providerSlug: PROVIDER,
        authMethod: 'env',
        name: CREDENTIAL,
        envName: 'TALE_PROVIDER_KEY_E2E_MOCK',
      },
    },
  );
  expect(credential.status(), await credential.text()).toBe(200);
}
