'use node';

/**
 * Model-catalog refresh — the "solid update strategy".
 *
 * Fetches model capabilities from a PROVEN external source and upserts them into
 * `modelCapabilityCache`, which the resolver layers UNDER operator config and
 * OVER the built-in registry. So capability facts stay fresh from a real source
 * instead of being hand-maintained in code, while operators can still override
 * per-model in provider config.
 *
 * Source: OpenRouter's public `/api/v1/models` (no key, authoritative for the
 * exact `vendor/model` ids the default gateway exposes, returns pricing,
 * context length, modalities, and `supported_parameters`). Runs on a daily cron
 * and on-demand from the providers settings UI (developer-gated).
 */

import path from 'node:path';

import { v } from 'convex/values';

import { isValidOrgSlug } from '../../lib/shared/constants/org-slug';
import { syncProviderModels } from '../../lib/shared/model-sync';
import {
  type ProviderJson,
  providerJsonSchema,
} from '../../lib/shared/schemas/providers';
import { getString, isRecord } from '../../lib/utils/type-utils';
import { components, internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { normalizeCatalogPayload } from '../lib/agent_response/model_capabilities/normalize';
import { atomicWrite, readFileSafe, readdirSafe } from '../lib/file_io';
import { safeFetch, SafeFetchError } from '../lib/http/safe_fetch';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import {
  parseProviderJson,
  resolveProviderFilePath,
  resolveProvidersDir,
  serializeProviderJson,
} from '../providers/file_utils';

const OPENROUTER_CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const SOURCE = 'openrouter';
const UPSERT_CHUNK = 100;
/** Network fetch is retried; the upsert/record mutations are not (they don't
 * touch the network and Convex retries them on its own). */
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2_000;

interface SyncResult {
  ok: boolean;
  modelCount: number;
  error?: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch + parse the catalog with bounded linear-backoff retries. Self-hosted
 * instances can be offline or behind a flaky egress path, so a transient
 * failure shouldn't burn the whole refresh — we retry a few times and log each
 * attempt (with an explicit offline hint) so operators can see what happened in
 * the instance logs. Throws the last error only after all attempts are spent.
 */
async function fetchCatalogWithRetries(): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await safeFetch(OPENROUTER_CATALOG_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        timeoutMs: 20_000,
        // The full OpenRouter catalog (hundreds of models with rich metadata)
        // exceeds safeFetch's 1 MB default and keeps growing; raise the cap so
        // the cron doesn't silently start failing once it crosses 1 MB.
        maxResponseBytes: 8 * 1024 * 1024,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `catalog fetch ${response.status} ${response.statusText}`,
        );
      }
      return JSON.parse(response.body);
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      // SafeFetchError covers DNS/connect/timeout — the typical "no internet"
      // signature on an air-gapped or egress-blocked instance.
      const offlineHint =
        err instanceof SafeFetchError
          ? ' — the instance may be offline or the catalog host is unreachable'
          : '';
      console.warn(
        `[model-catalog] fetch attempt ${attempt}/${MAX_FETCH_ATTEMPTS} failed: ${message}${offlineHint}`,
      );
      if (attempt < MAX_FETCH_ATTEMPTS)
        await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/**
 * Core refresh: fetch → normalize → upsert → record. Shared by the cron and the
 * developer-gated UI action. Never throws — records and returns the outcome so
 * a failed fetch degrades to the existing cache rather than erroring.
 */
async function runRefresh(ctx: ActionCtx, nowMs: number): Promise<SyncResult> {
  try {
    const json = await fetchCatalogWithRetries();
    const entries = normalizeCatalogPayload(json);

    for (let i = 0; i < entries.length; i += UPSERT_CHUNK) {
      // `normalizeCatalogPayload` carries `displayName`/`isChat` for the
      // provider-config sync bot, but the `modelCapabilityCache` table (and the
      // upsert validator) only store the runtime capability fields. Project
      // those two off here — Convex object validators reject undeclared fields,
      // so passing them through would throw and the cache would never populate.
      const chunk = entries
        .slice(i, i + UPSERT_CHUNK)
        .map(({ displayName: _displayName, isChat: _isChat, ...row }) => row);
      await ctx.runMutation(
        internal.model_catalog.mutations.upsertCapabilities,
        { source: SOURCE, fetchedAt: nowMs, entries: chunk },
      );
    }

    await ctx.runMutation(internal.model_catalog.mutations.recordSync, {
      source: SOURCE,
      lastSyncedAt: nowMs,
      modelCount: entries.length,
      ok: true,
    });
    console.info(
      `[model-catalog] refresh ok: cached ${entries.length} models from ${SOURCE}`,
    );
    return { ok: true, modelCount: entries.length };
  } catch (err) {
    const message =
      err instanceof SafeFetchError || err instanceof Error
        ? err.message
        : String(err);
    console.warn('[model-catalog] refresh failed:', message);
    await ctx
      .runMutation(internal.model_catalog.mutations.recordSync, {
        source: SOURCE,
        lastSyncedAt: nowMs,
        modelCount: 0,
        ok: false,
        error: message,
      })
      .catch((recordErr: unknown) =>
        console.warn(
          '[model-catalog] failed to record sync failure:',
          recordErr instanceof Error ? recordErr.message : recordErr,
        ),
      );
    return { ok: false, modelCount: 0, error: message };
  }
}

/** Daily cron entry point (no auth). */
export const refreshModelCatalogCron = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await runRefresh(ctx, Date.now());
    return null;
  },
});

/** Developer-gated on-demand refresh from the providers settings UI. */
export const syncModelCatalog = action({
  args: { organizationId: v.string() },
  returns: v.object({
    ok: v.boolean(),
    modelCount: v.number(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SyncResult> => {
    await requireDeveloperSettingsAccessById(ctx, args.organizationId);
    return runRefresh(ctx, Date.now());
  },
});

// ---------------------------------------------------------------------------
// In-instance provider-config auto-sync (weekly).
//
// The cache refresh above keeps the runtime `modelCapabilityCache` fresh. This
// second flow goes further — the same thing the GitHub Action does for the
// shipped defaults, but for a RUNNING deployment: it 3-way-merges fresh
// OpenRouter facts into each org's on-disk provider config (refresh default
// fields, add newer flagship versions, hide superseded ones), preserving any
// value the operator changed. Per-org opt-out via `modelSyncSettings`.
// ---------------------------------------------------------------------------

const BUILTIN_ENV = 'TALE_CONFIG_BUILTIN_DIR';

/** Fetch + normalize the catalog into engine facts. Returns `[]` (logged) on a
 *  spent-retry failure so an offline instance simply skips this cycle. */
async function fetchFacts(): Promise<
  ReturnType<typeof normalizeCatalogPayload>
> {
  try {
    return normalizeCatalogPayload(await fetchCatalogWithRetries());
  } catch (err) {
    console.warn(
      '[model-catalog] provider-config sync skipped — catalog fetch failed:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** Read the shipped builtin (default) config for a provider — the 3-way base.
 *  Undefined when no builtin catalog is mounted (dev) or the file is absent. */
async function readBuiltinProvider(
  providerName: string,
): Promise<ProviderJson | undefined> {
  const root = process.env[BUILTIN_ENV];
  if (!root) return undefined;
  const filePath = path.join(
    root,
    'default',
    'providers',
    `${providerName}.json`,
  );
  const content = await readFileSafe(filePath);
  if (!content) return undefined;
  try {
    return parseProviderJson(content);
  } catch (err) {
    console.warn(
      `[model-catalog] failed to parse builtin provider '${providerName}':`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/** Apply the merge engine to every provider config of one org, writing back
 *  only files that actually changed. Returns the number of changed providers.
 *  Best-effort: reads → merges → writes without the optimistic-hash guard
 *  `saveProvider` uses. A rare weekly race with a concurrent operator edit is
 *  last-writer-wins, but the merge only ever touches catalog fields the operator
 *  hasn't customized, so a clobbered run simply re-applies next week. */
async function updateOrgProviderConfigs(
  orgSlug: string,
  facts: ReturnType<typeof normalizeCatalogPayload>,
): Promise<number> {
  if (facts.length === 0) return 0;
  const dir = resolveProvidersDir(orgSlug);
  const files = (await readdirSafe(dir)).filter(
    (f) => f.endsWith('.json') && !f.endsWith('.secrets.json'),
  );
  let changedProviders = 0;
  for (const file of files) {
    const providerName = file.slice(0, -'.json'.length);
    const filePath = resolveProviderFilePath(orgSlug, providerName);
    const content = await readFileSafe(filePath);
    if (!content) continue;
    let current: ProviderJson;
    try {
      current = parseProviderJson(content);
    } catch (err) {
      console.warn(
        `[model-catalog] ${orgSlug}/${file}: unparseable, skipping —`,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }
    const base = await readBuiltinProvider(providerName);
    const { models, changes } = syncProviderModels({
      current: current.models,
      base: base?.models,
      facts,
    });
    if (changes.length === 0) continue;

    const next = { ...current, models };
    const validated = providerJsonSchema.safeParse(next);
    if (!validated.success) {
      console.error(
        `[model-catalog] ${orgSlug}/${file}: merged config invalid, skipping — ${validated.error.issues[0]?.message}`,
      );
      continue;
    }
    await atomicWrite(filePath, serializeProviderJson(validated.data));
    changedProviders++;
    console.info(
      `[model-catalog] ${orgSlug}/${file}: applied ${changes.length} change(s)`,
    );
  }
  return changedProviders;
}

/**
 * Weekly cron: 3-way-merge fresh catalog facts into every org's provider config
 * (skipping orgs that disabled auto-sync). Never throws — per-org failures are
 * logged and the sweep continues.
 */
export const refreshProviderConfigsCron = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const facts = await fetchFacts();
    if (facts.length === 0) return null;

    // Enumerate orgs from Better Auth (id + slug), same source as the reseeder.
    // Guarded against a non-terminating adapter: a hard page cap AND a
    // cursor-must-advance check so a stuck cursor can't spin the action to its
    // wall-clock limit.
    const orgs: Array<{ id: string; slug: string }> = [];
    let cursor: string | null = null;
    let prevCursor: string | null | undefined;
    let isDone = false;
    let pages = 0;
    while (!isDone) {
      if (pages++ >= 1000) {
        console.warn(
          '[model-catalog] org pagination hit the page cap; truncating sweep',
        );
        break;
      }
      if (prevCursor !== undefined && cursor === prevCursor) {
        console.warn(
          '[model-catalog] org pagination cursor did not advance; aborting sweep',
        );
        break;
      }
      prevCursor = cursor;
      const res: unknown = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'organization',
          paginationOpts: { cursor, numItems: 200 },
          where: [],
        },
      );
      const page = isRecord(res) && Array.isArray(res.page) ? res.page : [];
      for (const raw of page) {
        if (!isRecord(raw)) continue;
        const id = getString(raw, 'id');
        const slug = getString(raw, 'slug');
        if (id && slug && isValidOrgSlug(slug)) orgs.push({ id, slug });
      }
      cursor =
        isRecord(res) && typeof res.continueCursor === 'string'
          ? res.continueCursor
          : null;
      isDone =
        isRecord(res) && typeof res.isDone === 'boolean' ? res.isDone : true;
    }

    let updated = 0;
    for (const org of orgs) {
      const enabled = await ctx.runQuery(
        internal.model_catalog.queries.isAutoSyncEnabledInternal,
        { organizationId: org.id },
      );
      if (!enabled) continue;
      try {
        updated += await updateOrgProviderConfigs(org.slug, facts);
      } catch (err) {
        console.error(
          `[model-catalog] provider-config sync failed for "${org.slug}":`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    console.info(
      `[model-catalog] provider-config sync done: ${updated} provider file(s) updated across ${orgs.length} org(s)`,
    );
    return null;
  },
});

/** Developer-gated toggle for the weekly provider-config auto-sync (UI). */
export const setModelAutoSync = action({
  args: { organizationId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireDeveloperSettingsAccessById(ctx, args.organizationId);
    await ctx.runMutation(internal.model_catalog.mutations.setAutoSyncEnabled, {
      organizationId: args.organizationId,
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});
