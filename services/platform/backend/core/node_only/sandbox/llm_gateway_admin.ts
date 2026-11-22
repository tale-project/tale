'use node';

// The client of the sandbox LLM gateway an earlier release ran (pinned
// maximhq/bifrost, management API verified against v2.2.4), kept for the
// keys that gateway minted before the in-process model relay served every
// turn and every call of the model endpoints for API keys
// (tale-project/tale#4942). Nothing is pushed to the gateway any more; what
// is left is what the settlement of such a key, and a deleted
// organization's teardown, still ask of it:
//   - a key's cumulative spend, for the usage ledger,
//   - moving a key's spend cap,
//   - revoking a key,
//   - removing a deleted organization's provider keys and records.
//
// A deploy retires the gateway's container once no key it minted is open
// (`GET /api/control/gateway-keys`), and keeps its volume. A gateway whose
// name no longer resolves (`getaddrinfo ENOTFOUND`) is that retired gateway:
// a key's spend reads `gone`, so it closes without a figure, and a revoke, a
// cap or an organization's removal finds nothing left to change. Any other
// failure (a lookup the resolver could not finish, a refused connection, a
// timeout, a 5xx) is a gateway away for a while, and the caller tries again
// as before.
//
// The admin password is a Tier-0 secret: it lives only in the platform's
// environment and in the gateway's store, never in the sandbox.

import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { getString, isRecord } from '../../../../lib/utils/type-utils';
import { sanitizeError } from '../../lib/utils/sanitize_secrets';
import type { GatewaySpendReading } from './gateway_key_settlement';

/**
 * Read a `SANDBOX_LLM_GATEWAY_*` env var, falling back to the pre-rename
 * `LLM_GATEWAY_*` name — `.env.example` documents that operators' old names
 * are still read, so an existing deployment keeps working until `tale
 * upgrade` rewrites its env file.
 */
function gatewayEnv(suffix: string): string | undefined {
  return (
    process.env[`SANDBOX_LLM_GATEWAY_${suffix}`] ??
    process.env[`LLM_GATEWAY_${suffix}`]
  );
}

function llmGatewayUrl(): string {
  return gatewayEnv('URL') ?? 'http://sandbox-llm-gateway:8080';
}

/** Admin username for the gateway management plane (auth_config). */
function adminUsername(): string {
  return gatewayEnv('ADMIN_USERNAME') ?? 'admin';
}

/** The plaintext admin password of the gateway's management plane, which
 * every management call sends as HTTP Basic; undefined when the deployment
 * carries none (blank counts as none). A new install has none: it never ran
 * the gateway, and nothing ever pushed an organization's provider keys into
 * one without it. */
function adminPassword(): string | undefined {
  const password = gatewayEnv('ADMIN_PASSWORD')?.trim();
  return password === undefined || password === '' ? undefined : password;
}

/** What a management call throws once the gateway's name no longer
 * resolves: its container was retired, and what it held can be neither read
 * nor changed any more. */
class GatewayRetiredError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      `the sandbox LLM gateway at ${llmGatewayUrl()} no longer resolves: it is retired`,
      options,
    );
    this.name = 'GatewayRetiredError';
  }
}

/** Whether `error`, or what caused it, says that the gateway's name does not
 * resolve. Node's fetch carries the resolver's error as its `cause`; Bun's
 * fetch and every `lookup` throw it as it is. `EAI_AGAIN` — a lookup the
 * resolver could not finish — is not this: it says nothing of the name. */
function nameNotFound(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    if (current.code === 'ENOTFOUND') return true;
    current = current.cause;
  }
  return false;
}

/** Whether this process said already that the gateway is retired. */
let retiredNoticeGiven = false;

/** The retired gateway, said once per process: every key it minted then
 * closes without a figure, each with a line of its own from the settlement. */
function retired(cause?: unknown): GatewayRetiredError {
  const error = new GatewayRetiredError(
    cause === undefined ? undefined : { cause },
  );
  if (!retiredNoticeGiven) {
    retiredNoticeGiven = true;
    console.info(
      `[llm-gateway] ${error.message}; the keys it minted close without a figure, and nothing is removed from it any more`,
    );
  }
  return error;
}

/** Whether the gateway's name still resolves, asked when the deployment
 * holds no admin password: without the name there is no gateway to ask;
 * with it, the missing password is what keeps the call from being made. A
 * lookup that cannot finish throws, and the caller tries again later. */
async function gatewayNameResolves(): Promise<boolean> {
  const host = new URL(llmGatewayUrl()).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0) return true;
  try {
    await lookup(host);
    return true;
  } catch (error) {
    if (nameNotFound(error)) return false;
    throw error;
  }
}

/** The waits before each repeat of a management call the gateway's store
 * turned away for a moment — about three seconds in all. */
const STORE_BUSY_RETRY_DELAYS_MS = [250, 750, 2_000] as const;

/** Every call left is idempotent: a read, a cap's update, a delete. */
type ManagementMethod = 'GET' | 'PUT' | 'DELETE';

/** How long one attempt of a management call may take. */
const MANAGEMENT_TIMEOUT_MS = 15_000;

/**
 * One call to the gateway's management API: `path` under its base URL, with
 * the admin credentials as HTTP Basic and a 15 s bound per attempt, `json` as
 * the body. Throws {@link GatewayRetiredError} once the gateway's name no
 * longer resolves, and, on a deployment without the admin password, an
 * error that says so while the name still resolves.
 *
 * The gateway keeps its config in SQLite, which turns away a write that
 * collides with another one. It answers those with a 500 that names the
 * locked store, except a virtual key's DELETE, which says only that it
 * failed. Every call here is idempotent, so a call answered with a 5xx is
 * sent again after a short wait, up to three times, and the last answer is
 * returned for the caller to read.
 */
async function managementFetch(
  path: string,
  init: { method?: ManagementMethod; json?: unknown } = {},
): Promise<Response> {
  const password = adminPassword();
  if (password === undefined) {
    if (!(await gatewayNameResolves())) throw retired();
    throw new Error(
      `SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD is not set, so the sandbox LLM gateway at ${llmGatewayUrl()} cannot be asked about the keys it minted: set it to the password the gateway was deployed with, or retire the gateway`,
    );
  }
  const method = init.method ?? 'GET';
  const authorization = `Basic ${Buffer.from(
    `${adminUsername()}:${password}`,
  ).toString('base64')}`;
  const request = async (): Promise<Response> => {
    try {
      return await fetch(`${llmGatewayUrl()}${path}`, {
        method,
        headers: { 'content-type': 'application/json', authorization },
        ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
        signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
      });
    } catch (error) {
      if (nameNotFound(error)) throw retired(error);
      throw error;
    }
  };
  for (const delayMs of STORE_BUSY_RETRY_DELAYS_MS) {
    const res = await request();
    if (res.status < 500) return res;
    const text = await res.text().catch((error: unknown) => {
      console.warn(
        `[llm-gateway] ${method} ${path} answered ${res.status} with an unreadable body:`,
        error,
      );
      return '';
    });
    const said = sanitizeError(text).replace(/\s+/g, ' ').trim().slice(0, 200);
    console.warn(
      `[llm-gateway] ${method} ${path} answered ${res.status} (${said}); sending it again in ${delayMs} ms`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return request();
}

/** DELETE /api/governance/virtual-keys/:id — instant revoke (session
 * teardown, a turn's settlement). A 404 means it is already gone, and so is
 * every key of a retired gateway. */
export async function revokeVirtualKey(keyId: string): Promise<void> {
  let res: Response;
  try {
    res = await managementFetch(
      `/api/governance/virtual-keys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE' },
    );
  } catch (error) {
    if (error instanceof GatewayRetiredError) return;
    throw error;
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `llm-gateway revoke key failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/** The lowest cap a key is moved to: a turn whose allowance is spent keeps
 * a key that refuses its next call, not one the gateway's validator refuses. */
const MIN_KEY_BUDGET_CENTS = 0.01;

/**
 * Move a key's spend cap, in cents, through `PUT
 * /api/governance/virtual-keys/:id`. The key keeps its budget row and the
 * usage already counted against it: on the pinned gateway `current_usage`
 * survives the update, and a cap moved below it refuses the next call (402).
 * A turn's generated images are paid outside its key but from the same
 * allowance, so the cap gives up their cost as they are admitted and booked.
 * A key the gateway no longer holds answers `gone`, and so does every key of
 * a retired gateway; any other failure throws.
 */
export async function setVirtualKeyBudget(
  keyId: string,
  budgetCents: number,
): Promise<'ok' | 'gone'> {
  try {
    return await moveVirtualKeyBudget(keyId, budgetCents);
  } catch (error) {
    if (error instanceof GatewayRetiredError) return 'gone';
    throw error;
  }
}

async function moveVirtualKeyBudget(
  keyId: string,
  budgetCents: number,
): Promise<'ok' | 'gone'> {
  const path = `/api/governance/virtual-keys/${encodeURIComponent(keyId)}`;
  // The budget row's id, so the update names the row whose usage it keeps.
  const current = await managementFetch(path);
  if (current.status === 404) return 'gone';
  if (!current.ok) {
    throw new Error(
      `llm-gateway read key failed (${current.status}): ${sanitizeError(await current.text())}`,
    );
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await current.json()) as {
    virtual_key?: { budgets?: unknown };
  };
  const budgets = parsed.virtual_key?.budgets;
  const first: unknown = Array.isArray(budgets) ? budgets[0] : undefined;
  const budgetId = isRecord(first) ? getString(first, 'id') : undefined;
  const res = await managementFetch(path, {
    method: 'PUT',
    json: {
      budgets: [
        {
          ...(budgetId !== undefined ? { id: budgetId } : {}),
          max_limit: Math.max(budgetCents, MIN_KEY_BUDGET_CENTS) / 100,
          reset_duration: '1M',
        },
      ],
    },
  });
  if (res.status === 404) return 'gone';
  if (!res.ok) {
    throw new Error(
      `llm-gateway update key budget failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
  return 'ok';
}

/**
 * Cumulative spend on a virtual key, in (fractional) cents, from
 * `GET /api/governance/virtual-keys/:id` → the key's `budgets[].current_usage`
 * (dollars; the pre-multi-budget singular `budget` is still read). Every
 * budget on a key meters the same requests over its own reset window, so the
 * largest figure is the key's spend. The budget figure is the gateway's only
 * authoritative spend signal — and the only usage source that works where a
 * harness's own stream reports 0 tokens. The three answers are the
 * settlement's three branches: a figure, a key the gateway no longer knows —
 * or a gateway that is retired — whose figure is gone (book nothing and move
 * on), or a gateway that could not answer (try again later; never delete the
 * key before its spend is read). A key held without any budget answers 0,
 * flagged `unmetered`.
 *
 * Read LIVE (`from_memory=true`): the gateway meters in memory and dumps the
 * counters to its store only every ~10 s, and the plain read serves the
 * store — a settle seconds after the turn's last call was missing that call
 * (a 156-cent turn booked 150; a one-call retry booked 0). The live index is
 * what the gateway's own budget gate reads. A key the live index does not
 * hold (a gateway restarted mid-turn reloads from the store) falls back to
 * the stored row before it is declared gone.
 */
export async function readVirtualKeySpend(
  keyId: string,
): Promise<GatewaySpendReading> {
  const path = `/api/governance/virtual-keys/${encodeURIComponent(keyId)}`;
  const read = (fromMemory: boolean) =>
    managementFetch(fromMemory ? `${path}?from_memory=true` : path);
  let res: Response;
  try {
    res = await read(true);
    if (res.status === 404) res = await read(false);
  } catch (error) {
    if (error instanceof GatewayRetiredError) return { status: 'gone' };
    throw error;
  }
  if (res.status === 404) return { status: 'gone' };
  if (!res.ok) {
    // A down gateway is not "key not found" — say so, and let the caller
    // defer instead of stamping a zero cost. keyId is an id, not a secret.
    console.warn(
      `[llm-gateway] spend read failed (${res.status}) for key ${keyId}; settlement deferred`,
    );
    return { status: 'unavailable' };
  }
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
  const parsed = (await res.json()) as {
    virtual_key?: {
      budgets?: unknown;
      budget?: { current_usage?: number };
    };
    budget?: { current_usage?: number };
  };
  const budgets = parsed.virtual_key?.budgets;
  const usages = [
    ...(Array.isArray(budgets) ? budgets : []).map((budget: unknown) =>
      isRecord(budget) ? budget.current_usage : undefined,
    ),
    parsed.virtual_key?.budget?.current_usage,
    parsed.budget?.current_usage,
  ].filter(
    (usage): usage is number =>
      typeof usage === 'number' && Number.isFinite(usage),
  );
  if (usages.length === 0) {
    // A key without a budget is unmetered: say so instead of stamping a
    // silent zero.
    console.warn(
      `[llm-gateway] key ${keyId} carries no budget; its spend is unknown`,
    );
    return { status: 'ok', cents: 0, unmetered: true };
  }
  // Sub-cent spends are real with cheap models — keep the precision.
  return { status: 'ok', cents: Math.max(...usages) * 100 };
}

/**
 * The name an organization's upstream key carried on a gateway record:
 * unique across the gateway, since its config store holds one key-name index
 * over all providers, so each organization's key could sit beside the
 * others' under one shared record.
 */
function gatewayKeyName(organizationId: string, provider: string): string {
  return `tale-${organizationId}-${provider}`;
}

/** DELETE /api/providers/:name — remove a provider RECORD with its key
 * sub-resources (verified: GET 404s after). Tolerates 404 (already gone). */
async function deleteGatewayProvider(name: string): Promise<void> {
  const res = await managementFetch(
    `/api/providers/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `llm-gateway delete provider ${name} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/** GET /api/providers — the name of every provider record the gateway
 * holds. Throws when the gateway does not answer with the list: a teardown
 * must never read a failed listing as "nothing left". */
async function listGatewayProviderNames(): Promise<string[]> {
  const res = await managementFetch('/api/providers');
  if (!res.ok) {
    throw new Error(
      `llm-gateway list providers failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
  const parsed: unknown = await res.json();
  if (!isRecord(parsed) || !Array.isArray(parsed.providers)) {
    throw new Error('llm-gateway list providers answered without a list');
  }
  return parsed.providers.flatMap((provider: unknown) =>
    isRecord(provider) && typeof provider.name === 'string'
      ? [provider.name]
      : [],
  );
}

/** GET /api/providers/:provider/keys for a teardown: a record that is gone
 * has no keys, and any other failure throws rather than reading as none. */
async function readProviderKeysForRemoval(
  provider: string,
): Promise<{ id: string; name: string }[]> {
  const res = await managementFetch(
    `/api/providers/${encodeURIComponent(provider)}/keys`,
  );
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(
      `llm-gateway list keys for provider ${provider} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
  const parsed: unknown = await res.json();
  if (!isRecord(parsed)) {
    throw new Error(
      `llm-gateway list keys for provider ${provider} answered without a list`,
    );
  }
  if (parsed.keys === null || parsed.keys === undefined) return [];
  if (!Array.isArray(parsed.keys)) {
    throw new Error(
      `llm-gateway list keys for provider ${provider} answered without a list`,
    );
  }
  return parsed.keys.flatMap((key: unknown) =>
    isRecord(key) && typeof key.id === 'string' && typeof key.name === 'string'
      ? [{ id: key.id, name: key.name }]
      : [],
  );
}

/** DELETE /api/providers/:provider/keys/:id — one upstream key. A 404 means
 * it (or its record) is already gone. */
async function deleteProviderKey(
  provider: string,
  keyId: string,
): Promise<void> {
  const res = await managementFetch(
    `/api/providers/${encodeURIComponent(provider)}/keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `llm-gateway delete key ${keyId} of provider ${provider} failed (${res.status}): ${sanitizeError(await res.text())}`,
    );
  }
}

/** What {@link removeOrganizationFromGateway} removed. */
export interface GatewayOrganizationRemoval {
  /** The organization's own per-(connector, model) records, keys and all. */
  records: number;
  /** Its upstream keys on records it shares with other organizations. */
  keys: number;
}

/**
 * Remove what the gateway still holds for a deleted organization. Revoking
 * its virtual keys leaves the provider credentials they spent through in the
 * gateway's store: its upstream key on every shared record (each standard
 * provider's, found by the exact name {@link gatewayKeyName} gave it), and
 * its own records — the per-(org, connector, model) ones
 * `resolveGatewayRouting` names, which go with their keys.
 *
 * Idempotent: a record or key already gone counts as removed, and a second
 * run finds nothing to do. Every record is tried; the call throws when the
 * gateway cannot be listed or any removal failed, so the caller retries.
 * Nothing is left to remove on a deployment without the admin password —
 * nothing ever pushed an organization into a gateway without it — nor on a
 * retired gateway. An own record is `<org>__<slug>__<model>`; one that goes
 * on with another `_` after `<org>__` is the record of an organization whose
 * id continues with `_`, and is left alone.
 */
export async function removeOrganizationFromGateway(
  organizationId: string,
): Promise<GatewayOrganizationRemoval> {
  const removed: GatewayOrganizationRemoval = { records: 0, keys: 0 };
  if (adminPassword() === undefined) return removed;
  const ownPrefix = `${organizationId}__`.replace(/\//g, '_');
  const keyName = (provider: string) =>
    gatewayKeyName(organizationId, provider);
  let providers: string[];
  try {
    providers = await listGatewayProviderNames();
  } catch (error) {
    if (error instanceof GatewayRetiredError) return removed;
    throw error;
  }
  const failed: string[] = [];
  for (const provider of providers) {
    try {
      if (
        provider.startsWith(ownPrefix) &&
        provider[ownPrefix.length] !== '_'
      ) {
        await deleteGatewayProvider(provider);
        removed.records += 1;
        continue;
      }
      for (const key of await readProviderKeysForRemoval(provider)) {
        if (key.name !== keyName(provider)) continue;
        await deleteProviderKey(provider, key.id);
        removed.keys += 1;
      }
    } catch (error) {
      // Retired while this ran: what it still held is out of reach, and
      // nothing serves it any more.
      if (error instanceof GatewayRetiredError) return removed;
      console.error(
        `[llm-gateway] removing organization ${organizationId} from provider ${provider} failed:`,
        error,
      );
      failed.push(provider);
    }
  }
  if (failed.length > 0) {
    throw new Error(
      `llm-gateway still holds organization ${organizationId} on: ${failed.join(', ')}`,
    );
  }
  return removed;
}

/** sha256 hex of a turn's key or bridge token — what gets persisted (never
 * the plaintext). */
export function hashVirtualKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
