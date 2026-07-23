'use node';

/**
 * Convert each org's retired file-based provider auth into
 * `providerCredentials` rows.
 *
 * The old backend kept provider authentication in per-org config FILES; the
 * rewrite keeps it in the `providerCredentials` table. `up` reads, per
 * organization:
 *
 *   - `providers/<name>.json` + its `<name>.secrets.json` sidecar — the
 *     provider-level `secretsEnv` becomes an `env` row, the sidecar `apiKey`
 *     an `api-key` row (re-encrypted with `lib/secret_box`), and the
 *     model-scoped sources (`models[].secretsEnv`, `secrets.modelKeys`)
 *     become rows restricted via `modelAllowlist`. The provider-level env
 *     row is inserted FIRST so it becomes the pair's default, matching the
 *     retired resolution order (env preferred over the file key); a
 *     deployment whose env var is unset now gets a loud, actionable
 *     resolution error instead of the old silent file fallback.
 *   - `token-sources/<slug>.json` + its `<slug>.secrets.json` sidecar —
 *     each becomes a `subscription-broker` credential on the `anthropic`
 *     connector (the only shipped connector offering that method; the
 *     retired feature existed solely to attach Claude subscriptions to the
 *     claude-code harness). The old schema maps field-for-field onto
 *     `brokerCredentialDataSchema` (`method`→`httpMethod`,
 *     `responseMapping.statusActiveValue`→`activeValue`,
 *     `responseMapping.expiryField`→`expiresField`; sidecar `authSecret`
 *     folded into the encrypted broker document). Dropped: `slug` and
 *     `displayName` stop being config data — the display name becomes the
 *     row name, with the slug appended only to disambiguate duplicates. A
 *     non-https endpoint cannot map (the live broker fetch is SSRF-guarded,
 *     https-only) and is skipped with a warning.
 *
 * Rows are stamped `createdBy: migration:<id>`. Old files are LEFT IN PLACE
 * — nothing live reads them, and a later cleanup phase removes them — so
 * `up` is purely additive (`destructive: false`, no snapshot needed).
 * Idempotent per org: rows that already exist under the marker are skipped
 * via `listCredentialFactsInternal`; a name held by anyone else (a
 * credential the user created between runs) is skipped with a warning and
 * never overwritten. Corrupt or unreadable files are skipped with a warning
 * exactly as the retired loaders skipped them — they carried no usable
 * credential in the old world either.
 *
 * `down` deletes exactly the rows carrying the marker
 * (`removeMigratedCredentialsInternal`), restoring the pre-migration table
 * byte-for-byte; the untouched files remain the source the next `up` reads.
 */

import { brokerCredentialDataSchema } from '../../../../../lib/shared/schemas/providers';
import { internal } from '../../../../_generated/api';
import {
  listProviderNames,
  parseProviderJson,
  parseProviderSecrets,
  resolveProviderFilePath,
  resolveProviderSecretsPath,
} from '../../../../legacy/frozen/providers_file_utils';
import type { ProviderJson } from '../../../../legacy/frozen/schemas_providers';
import type { TokenSource } from '../../../../legacy/frozen/schemas_token_sources';
import {
  listTokenSourceSlugs,
  parseTokenSourceJson,
  parseTokenSourceSecrets,
  resolveTokenSourceFilePath,
  resolveTokenSourceSecretsPath,
} from '../../../../legacy/frozen/token_sources_file_utils';
import { errnoCode, sha256 } from '../../../../lib/file_io';
import {
  encryptSecret,
  type EncryptedSecret,
} from '../../../../lib/secret_box';
import { decryptSecretsFile } from '../../../../lib/sops';
import { maskSecret } from '../../../../provider_credentials/masking';
import type { BoundNodeHelpers } from '../../../framework/define';
import { defineNodeMigration } from '../../../framework/define';
import type { MigrationOrg, NodeMigrationCtx } from '../../../framework/types';

/**
 * The connector migrated token sources attach to: `subscription-broker` is
 * offered by exactly one shipped connector
 * (`configs/platform/system/providers/anthropic.yml`), and every retired
 * token source fed a Claude-subscription OAuth pool. A frozen constant, not
 * a live connector lookup — the migration is a point-in-time transform and
 * must not change meaning when the connector catalog evolves.
 */
const TOKEN_SOURCE_PROVIDER_SLUG = 'anthropic';

/** `providerCredentials.name` cap (`mutations.ts` NAME_MAX). */
const NAME_MAX = 100;

/** One row the migration wants to insert, before the idempotency check. */
interface PlannedCredential {
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-broker';
  name: string;
  encryptedData?: EncryptedSecret;
  envName?: string;
  maskedPreview?: string;
  modelAllowlist?: string[];
}

/**
 * Fit a constructed label under the row-name cap, keeping it deterministic:
 * an overlong label is truncated and suffixed with a short content hash so
 * two long model ids can never fold onto the same name.
 */
function fitName(label: string): string {
  if (label.length <= NAME_MAX) return label;
  const hash = sha256(label).slice(0, 8);
  return `${label.slice(0, NAME_MAX - 9)}…${hash}`;
}

/** Case-insensitive per-provider name key — mirrors `assertNameFree`. */
function credentialKey(providerSlug: string, name: string): string {
  return `${providerSlug} ${name.trim().toLowerCase()}`;
}

/**
 * The decrypted secrets sidecar at `path`, or null when there is none.
 * An unreadable sidecar (SOPS key missing, corrupt JSON) is reported and
 * treated as absent — matching the retired loaders, which skipped exactly
 * those files — so one bad sidecar never wedges the org; a re-run after the
 * operator fixes it picks the rows up.
 */
async function readSecretsSidecar(
  path: string,
  label: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await decryptSecretsFile(path);
  } catch (err) {
    if (errnoCode(err) === 'ENOENT') return null;
    console.warn(
      `[provider-credentials-migration] ${label}: secrets sidecar unreadable, skipping its rows:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * The rows one retired `providers/<name>.json` (+ sidecar) converts into,
 * in default-priority order: provider env ref, provider api key, then the
 * model-scoped refs and keys (never a pair default unless they are alone).
 */
async function planProviderCredentials(
  helpers: BoundNodeHelpers,
  orgSlug: string,
  providerName: string,
): Promise<PlannedCredential[]> {
  const raw = await helpers.readFileSafe(
    resolveProviderFilePath(orgSlug, providerName),
  );
  if (raw === null) return [];
  let config: ProviderJson;
  try {
    config = parseProviderJson(raw);
  } catch (err) {
    console.warn(
      `[provider-credentials-migration] provider "${providerName}": config unreadable, skipping:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }

  const planned: PlannedCredential[] = [];
  if (config.secretsEnv !== undefined) {
    planned.push({
      providerSlug: providerName,
      authMethod: 'env',
      name: 'Environment key',
      envName: config.secretsEnv,
    });
  }

  const sidecar = await readSecretsSidecar(
    resolveProviderSecretsPath(orgSlug, providerName),
    `provider "${providerName}"`,
  );
  if (sidecar !== null) {
    try {
      const secrets = parseProviderSecrets(sidecar);
      planned.push({
        providerSlug: providerName,
        authMethod: 'api-key',
        name: 'API key',
        encryptedData: encryptSecret(secrets.apiKey),
        maskedPreview: maskSecret(secrets.apiKey),
      });
      for (const [modelId, key] of Object.entries(secrets.modelKeys ?? {}).sort(
        ([a], [b]) => a.localeCompare(b),
      )) {
        planned.push({
          providerSlug: providerName,
          authMethod: 'api-key',
          name: fitName(`Model key — ${modelId}`),
          encryptedData: encryptSecret(key),
          maskedPreview: maskSecret(key),
          modelAllowlist: [modelId],
        });
      }
    } catch (err) {
      console.warn(
        `[provider-credentials-migration] provider "${providerName}": secrets sidecar invalid, skipping its rows:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  for (const model of config.models) {
    if (model.secretsEnv === undefined) continue;
    planned.push({
      providerSlug: providerName,
      authMethod: 'env',
      name: fitName(`Model env key — ${model.id}`),
      envName: model.secretsEnv,
      modelAllowlist: [model.id],
    });
  }
  return planned;
}

/**
 * Fold one retired token source (+ its optional stored broker secret) into
 * the `brokerCredentialDataSchema` document a `subscription-broker` row
 * stores, or null when the source cannot map (non-https endpoint).
 */
function toBrokerDocument(
  source: TokenSource,
  authSecret: string | undefined,
): Record<string, unknown> | null {
  const document = {
    endpoint: source.endpoint,
    httpMethod: source.method,
    auth: source.auth,
    responseMapping: {
      tokensPath: source.responseMapping.tokensPath,
      tokenField: source.responseMapping.tokenField,
      ...(source.responseMapping.statusField !== undefined && {
        statusField: source.responseMapping.statusField,
      }),
      ...(source.responseMapping.statusActiveValue !== undefined && {
        activeValue: source.responseMapping.statusActiveValue,
      }),
      ...(source.responseMapping.expiryField !== undefined && {
        expiresField: source.responseMapping.expiryField,
      }),
    },
    targetEnvVar: source.targetEnvVar,
    selection: source.selection,
    timeoutMs: source.timeoutMs,
    maxResponseBytes: source.maxResponseBytes,
    expirySkewMs: source.expirySkewMs,
    ...(authSecret !== undefined && { authSecret }),
  };
  const result = brokerCredentialDataSchema.safeParse(document);
  if (!result.success) {
    console.warn(
      `[provider-credentials-migration] token source "${source.slug}": cannot map onto a broker credential (most likely a non-https endpoint), skipping.`,
    );
    return null;
  }
  return result.data;
}

/** The `subscription-broker` rows an org's retired token sources become. */
async function planTokenSourceCredentials(
  helpers: BoundNodeHelpers,
  orgSlug: string,
): Promise<PlannedCredential[]> {
  const sources: TokenSource[] = [];
  for (const slug of await listTokenSourceSlugs(orgSlug)) {
    const raw = await helpers.readFileSafe(
      resolveTokenSourceFilePath(orgSlug, slug),
    );
    if (raw === null) continue;
    try {
      sources.push(parseTokenSourceJson(raw));
    } catch (err) {
      console.warn(
        `[provider-credentials-migration] token source "${slug}": config unreadable, skipping:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Display names were not unique in the old format (the slug was); when two
  // sources share one, every clashing row carries its slug — symmetric, so
  // the naming never depends on iteration order.
  const nameCounts = new Map<string, number>();
  for (const source of sources) {
    const key = source.displayName.trim().toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const planned: PlannedCredential[] = [];
  for (const source of sources) {
    const duplicated =
      (nameCounts.get(source.displayName.trim().toLowerCase()) ?? 0) > 1;
    const label = duplicated
      ? `${source.displayName} (${source.slug})`
      : source.displayName;

    let authSecret: string | undefined;
    const sidecar = await readSecretsSidecar(
      resolveTokenSourceSecretsPath(orgSlug, source.slug),
      `token source "${source.slug}"`,
    );
    if (sidecar !== null) {
      try {
        authSecret = parseTokenSourceSecrets(sidecar).authSecret;
      } catch (err) {
        // The retired loader fell back to the env-ref on an invalid sidecar;
        // the broker document keeps that fallback via `auth.secretEnv`.
        console.warn(
          `[provider-credentials-migration] token source "${source.slug}": secrets sidecar invalid, migrating without a stored broker secret:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const broker = toBrokerDocument(source, authSecret);
    if (broker === null) continue;
    planned.push({
      providerSlug: TOKEN_SOURCE_PROVIDER_SLUG,
      authMethod: 'subscription-broker',
      name: fitName(label),
      encryptedData: encryptSecret(JSON.stringify(broker)),
      ...(authSecret !== undefined && {
        maskedPreview: maskSecret(authSecret),
      }),
    });
  }
  return planned;
}

/**
 * Insert the planned rows, skipping what already exists: marker-owned rows
 * silently (the idempotent re-run), anyone else's rows with a warning
 * (never overwritten).
 */
async function insertPlanned(
  ctx: NodeMigrationCtx,
  org: MigrationOrg,
  marker: string,
  planned: readonly PlannedCredential[],
): Promise<void> {
  const facts = (await ctx.runQuery(
    internal.provider_credentials.queries.listCredentialFactsInternal,
    { organizationId: org.id },
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal query's return validator pins exactly this shape
  )) as Array<{ providerSlug: string; name: string; createdBy: string }>;
  const ownerByKey = new Map(
    facts.map((fact) => [
      credentialKey(fact.providerSlug, fact.name),
      fact.createdBy,
    ]),
  );

  const seenThisRun = new Set<string>();
  for (const spec of planned) {
    const key = credentialKey(spec.providerSlug, spec.name);
    if (seenThisRun.has(key)) {
      console.warn(
        `[provider-credentials-migration] "${spec.name}" (${spec.providerSlug}): duplicate name within this org after normalization, skipping.`,
      );
      continue;
    }
    seenThisRun.add(key);

    const owner = ownerByKey.get(key);
    if (owner === marker) continue;
    if (owner !== undefined) {
      console.warn(
        `[provider-credentials-migration] "${spec.name}" (${spec.providerSlug}): a credential with this name already exists (created by ${owner}), skipping — never overwritten.`,
      );
      continue;
    }

    await ctx.runMutation(
      internal.provider_credentials.mutations.insertCredentialInternal,
      {
        organizationId: org.id,
        providerSlug: spec.providerSlug,
        authMethod: spec.authMethod,
        name: spec.name,
        ...(spec.encryptedData !== undefined && {
          encryptedData: spec.encryptedData,
        }),
        ...(spec.envName !== undefined && { envName: spec.envName }),
        ...(spec.maskedPreview !== undefined && {
          maskedPreview: spec.maskedPreview,
        }),
        ...(spec.modelAllowlist !== undefined && {
          modelAllowlist: spec.modelAllowlist,
        }),
        status: 'active',
        createdBy: marker,
      },
    );
    ownerByKey.set(key, marker);
  }
}

export const migration = defineNodeMigration({
  title: 'Convert provider auth files and token sources into credential rows',
  description:
    "Reads each org's retired providers/<name>.json configs (with their " +
    'secrets sidecars) and token-sources/<slug>.json files and inserts the ' +
    'equivalent providerCredentials rows — api-key secrets re-encrypted ' +
    'with secret_box, env references as env rows, token sources as ' +
    'subscription-broker rows — stamped createdBy migration:<id>; the old ' +
    'files are left in place. down deletes exactly the marker-stamped rows.',
  destructive: false,
  snapshot: 'none',
  subjects: {
    tables: ['providerCredentials'],
    domains: ['providers', 'token-sources'],
  },

  async up(ctx, org, helpers) {
    const marker = `migration:${helpers.migrationId}`;
    const planned: PlannedCredential[] = [];
    for (const providerName of await listProviderNames(org.slug)) {
      planned.push(
        ...(await planProviderCredentials(helpers, org.slug, providerName)),
      );
    }
    planned.push(...(await planTokenSourceCredentials(helpers, org.slug)));
    await insertPlanned(ctx, org, marker, planned);
  },

  async down(ctx, org, helpers) {
    const marker = `migration:${helpers.migrationId}`;
    const removed = (await ctx.runMutation(
      internal.provider_credentials.mutations.removeMigratedCredentialsInternal,
      { organizationId: org.id, createdBy: marker },
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the internal mutation's return validator pins v.number()
    )) as number;
    if (removed > 0) {
      console.log(
        `[provider-credentials-migration] removed ${removed} migrated credential row(s) for ${org.slug}.`,
      );
    }
  },
});
