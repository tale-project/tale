import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { verifyArtifactBytes } from './artifacts';
import {
  loadClient,
  releaseIdentity,
  sha256,
  stableJson,
  valueHash,
} from './identity';
import { loadRelease } from './manifest';
import {
  insist,
  NativeRequestError,
  ConfigError,
  integer,
  gitSha,
  repository,
  type Manifest,
  type RecordValue,
} from './model';

const deploymentSchema = z.union([
  z.strictObject({
    opsCommit: gitSha,
    catalogueRepository: repository,
    catalogueCommit: gitSha,
  }),
  z.strictObject({ deploymentRef: gitSha }),
]);

const positive = z.number().int().positive().safe();
const targetSchema = z.strictObject({
  origin: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  automationName: z.string(),
});
const previousSchema = z
  .strictObject({
    configVersion: z.string().optional(),
    releaseRef: gitSha.optional(),
    artifactSha256: z.string(),
    automationVersion: positive,
  })
  .refine(
    (value) =>
      (value.configVersion === undefined) !== (value.releaseRef === undefined),
    'receipt identity missing or ambiguous',
  );
const receiptSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    target: targetSchema,
    configVersion: z.string().optional(),
    releaseRef: gitSha.optional(),
    sourceCommit: gitSha.optional(),
    artifactSha256: z.string(),
    automationVersion: positive,
    previous: previousSchema.optional(),
  })
  .passthrough()
  .refine(
    (value) =>
      value.schemaVersion === 2
        ? value.configVersion === undefined &&
          value.releaseRef !== undefined &&
          value.releaseRef === value.sourceCommit
        : value.configVersion !== undefined && value.releaseRef === undefined,
    'receipt identity missing, ambiguous or different from source commit',
  );
// Native routes are checked individually below; unknown reply fields never
// enter a receipt or an error message. API error bodies may contain user data.
const replySchema = z
  .object({
    name: z.string().optional(),
    version: positive.optional(),
    deployedVersion: z.number().int().nullable().optional(),
    document: z.unknown().optional(),
    settings: z.unknown().optional(),
    presentation: z.record(z.string(), z.unknown()).optional(),
    testsPassed: z.boolean().optional(),
    projectIds: z.array(z.string()).optional(),
    skill: z
      .object({
        slug: z.string(),
        files: z.array(z.object({ path: z.string() })).optional(),
      })
      .optional(),
    asset: z.object({ path: z.string(), contentBase64: z.string() }).optional(),
    user: z.object({ id: z.string() }).optional(),
    storageId: z.string().optional(),
    ok: z.boolean().optional(),
    status: z.string().optional(),
    slug: z.string().optional(),
    warnings: z.array(z.unknown()).optional(),
    skills: z.array(z.unknown()).optional(),
    automations: z
      .array(
        z.object({
          name: z.string(),
          deployedVersion: z.number().nullable(),
          projectIds: z.array(z.string()),
          taskContract: z.unknown().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();
type Reply = z.infer<typeof replySchema>;
export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;
export interface DeployOptions {
  descriptorPath: string;
  automationName: string;
  manifestPath: string;
  url: string;
  origin?: string;
  orgId: string;
  projectId: string;
  cookie: string;
  receiptPath?: string;
  fetchImpl?: Fetch;
  automationVersion?: number;
  requireDeployed?: boolean;
  deployment?: z.infer<typeof deploymentSchema>;
}
class ContentMismatch extends ConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'ContentMismatch';
  }
}
function content(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContentMismatch(message);
}
function provenance(manifest: Manifest): RecordValue {
  return {
    manifestSchemaVersion: manifest.schemaVersion,
    sourceRepository: manifest.sourceRepository ?? null,
    clientId: manifest.clientId ?? null,
    descriptorPath: manifest.descriptorPath ?? null,
    descriptorSha256: manifest.descriptorSha256 ?? null,
    compilerVersion: manifest.compilerVersion ?? null,
    skillOwnerUserId: manifest.skillOwnerUserId ?? null,
    skillBindings: manifest.skillBindings ?? [],
    requiredExternalSkills: manifest.requiredExternalSkills ?? [],
    sourceCommit: manifest.sourceCommit,
    packTree: manifest.packTree,
  };
}
/** Credentials stay in memory. The caller holds a crash-released host flock or
 * advisory lock for the entire operation; persistent file existence is no lock. */
async function apply(
  options: DeployOptions,
  verifyOnly: boolean,
): Promise<RecordValue> {
  const context = loadClient(options.descriptorPath, options.automationName);
  const release = loadRelease(options.manifestPath, context);
  const { manifest, installation, historical } = release;
  const identity = releaseIdentity(manifest);
  const deployment =
    options.deployment === undefined
      ? undefined
      : deploymentSchema.parse(options.deployment);
  insist(
    verifyOnly || !historical || historical.allowExistingNativeReuse,
    'historical release is frozen for verification only; native reuse is not approved',
  );
  await verifyArtifactBytes(release);
  const base = new URL(options.url);
  const origin = new URL(options.origin ?? options.url);
  insist(
    base.pathname === '/' &&
      !base.search &&
      !base.hash &&
      !base.username &&
      !base.password,
    'Tale URL must be an origin',
  );
  insist(
    base.protocol === 'https:' ||
      (base.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)),
    'Tale URL must use HTTPS or loopback HTTP',
  );
  insist(
    origin.protocol === 'https:' &&
      origin.origin === (options.origin ?? options.url).replace(/\/$/, ''),
    'request origin must be the public HTTPS origin',
  );
  insist(
    typeof options.cookie === 'string' &&
      options.cookie.length > 0 &&
      !/[\r\n]/.test(options.cookie),
    'native session cookie is required',
  );
  for (const value of [options.orgId, options.projectId])
    insist(
      typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 128 &&
        !/[\r\n]/.test(value),
      'native org and project IDs are required',
    );
  insist(
    verifyOnly || options.receiptPath,
    'persistent receipt path is required',
  );
  if (options.automationVersion !== undefined)
    insist(
      integer(options.automationVersion),
      'native automation version must be a positive integer',
    );
  const automationPath = `/api/app/automations/${encodeURIComponent(manifest.automationName)}`;
  const fetchImpl: Fetch = options.fetchImpl ?? fetch;
  async function request(
    endpoint: string,
    args: {
      method?: string;
      body?: Buffer | RecordValue;
      raw?: boolean;
      allowNotFound?: boolean;
    } = {},
  ): Promise<Reply | null> {
    const target = new URL(endpoint, base);
    target.searchParams.set('orgId', options.orgId);
    const method = args.method ?? 'GET';
    const response = await fetchImpl(target, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
      headers: {
        cookie: options.cookie,
        origin: origin.origin,
        ...(args.body === undefined
          ? {}
          : {
              'content-type': args.raw ? 'application/zip' : 'application/json',
            }),
      },
      ...(args.body === undefined
        ? {}
        : {
            body: args.raw ? (args.body as Buffer) : JSON.stringify(args.body),
          }),
    }).catch(() => {
      throw new NativeRequestError(
        `Tale ${method} ${target.pathname} transport failed; the response may have been lost`,
      );
    });
    if (args.allowNotFound && response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new NativeRequestError(
        `Tale ${method} ${target.pathname} failed (HTTP ${response.status})`,
      );
    }
    const body: unknown = await response.json().catch(() => {
      throw new NativeRequestError(
        `Tale ${target.pathname} returned invalid JSON`,
      );
    });
    const result = replySchema.safeParse(body);
    insist(
      result.success,
      `Tale ${target.pathname} returned an invalid response`,
    );
    return result.data;
  }
  async function verifySkills(allowMissing: boolean): Promise<string[]> {
    const missing: string[] = [];
    for (const slug of manifest.skillSlugs) {
      const expected = manifest.skillFiles.filter((file) => file.slug === slug);
      const listing = await request(
        `/api/app/skills/${encodeURIComponent(slug)}`,
        { allowNotFound: true },
      );
      if (listing === null && allowMissing) {
        missing.push(slug);
        continue;
      }
      content(
        listing?.skill?.slug === slug && listing.skill.files,
        'native skill is missing',
      );
      content(
        stableJson(listing.skill.files.map((file) => file.path).sort()) ===
          stableJson(expected.map((file) => file.path).sort()),
        'native skill file inventory differs from release',
      );
      for (let offset = 0; offset < expected.length; offset += 8) {
        await Promise.all(
          expected.slice(offset, offset + 8).map(async (file) => {
            const assetPath = file.path
              .split('/')
              .map(encodeURIComponent)
              .join('/');
            const result = await request(
              `/api/app/skills/${encodeURIComponent(slug)}/assets/${assetPath}`,
              { allowNotFound: true },
            );
            content(
              result?.asset?.path === file.path,
              'native skill file response is invalid',
            );
            const bytes = Buffer.from(result.asset.contentBase64, 'base64');
            content(
              bytes.length === file.bytes && sha256(bytes) === file.sha256,
              `native skill file differs from release: ${slug}/${file.path}`,
            );
          }),
        );
      }
    }
    return missing;
  }
  async function verifyNative(
    version: number,
    requireDeployed: boolean,
  ): Promise<Reply & { version: number }> {
    const current = await request(`${automationPath}?version=${version}`);
    content(
      current?.name === manifest.automationName && current.version === version,
      'native automation identity/version differs from release',
    );
    content(
      valueHash(current.document) === manifest.documentSha256,
      'native workflow differs from release',
    );
    content(
      valueHash(current.settings ?? null) === manifest.settingsSha256,
      'native settings differ from release',
    );
    content(
      current.presentation?.name === manifest.displayName,
      'native display name differs from release',
    );
    if (manifest.schemaVersion !== 1)
      content(
        valueHash(current.presentation) === manifest.presentationSha256,
        'native presentation differs from release',
      );
    insist(
      current.testsPassed !== false,
      'native version carries failing tests',
    );
    if (requireDeployed) {
      insist(
        current.deployedVersion === version,
        'native deployment did not converge',
      );
      if (manifest.schemaVersion !== 1) {
        const listing = await request(
          `/api/app/automations/listing?projectId=${encodeURIComponent(options.projectId)}`,
        );
        const rows = listing?.automations?.filter(
          (item) => item.name === manifest.automationName,
        );
        const row = rows?.[0];
        content(
          rows?.length === 1 &&
            row?.deployedVersion === version &&
            row.projectIds.includes(options.projectId),
          'deployed native listing identity differs',
        );
        content(
          valueHash(row.taskContract ?? null) === manifest.taskContractSha256,
          'deployed task contract differs from release',
        );
      }
    }
    const bindings = await request(`${automationPath}/projects`);
    content(
      bindings?.projectIds?.includes(options.projectId),
      'native automation is not bound to the requested existing project',
    );
    await verifySkills(false);
    return { ...current, version };
  }
  // Read every owned byte before any write. Native storage is editable by an
  // administrator; a saved workflow pointer cannot prove current skill bytes.
  const missing = await verifySkills(
    manifest.schemaVersion !== 1 && !verifyOnly,
  );
  for (const slug of manifest.requiredExternalSkills ?? []) {
    const external = await request(
      `/api/app/skills/${encodeURIComponent(slug)}`,
      { allowNotFound: true },
    );
    insist(
      external?.skill?.slug === slug,
      `required external native tool skill missing: ${slug}`,
    );
  }
  const result = {
    ...(manifest.schemaVersion === 4
      ? { releaseRef: identity }
      : { configVersion: identity }),
    automationName: manifest.automationName,
    artifactSha256: manifest.artifact.sha256,
    ...provenance(manifest),
    sourceRepository: manifest.sourceRepository ?? historical?.sourceRepository,
    manifestSha256: sha256(readFileSync(options.manifestPath)),
    ...(deployment ? { deployment } : {}),
  };
  if (verifyOnly) {
    const version =
      options.automationVersion ?? (await request(automationPath))?.version;
    insist(
      integer(version),
      'native automation version is required for verification',
    );
    await verifyNative(version, options.requireDeployed ?? true);
    return {
      ...result,
      automationVersion: version,
      skillFilesVerified: manifest.skillFiles.length,
      verified: true,
    };
  }
  const receiptPath = options.receiptPath;
  insist(receiptPath, 'persistent receipt path is required');
  let previous: z.infer<typeof receiptSchema> | undefined;
  try {
    previous = receiptSchema.parse(
      JSON.parse(readFileSync(receiptPath, 'utf8')),
    );
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new Error(
        'deployment receipt is unreadable; inspect it before retrying',
        { cause: error },
      );
  }
  if (manifest.schemaVersion !== 1 && manifest.skillSlugs.length) {
    insist(installation, 'compiled installation missing');
    const session = await request('/api/auth/get-session');
    insist(
      session?.user?.id === manifest.skillOwnerUserId,
      'native uploader differs from compiled skill owner',
    );
    for (const slug of missing) {
      const artifact = installation.skills.find((item) => item.slug === slug);
      insist(artifact, 'skill installation artifact missing');
      const staged = await request(
        '/api/app/files/upload?purpose=skill_bundle',
        { method: 'POST', raw: true, body: artifact.bytes },
      );
      insist(
        staged?.storageId,
        'native skill upload did not return a storage ID',
      );
      const created = await request('/api/app/skills/upload', {
        method: 'POST',
        body: { storageId: staged.storageId },
      });
      insist(
        created?.slug === slug &&
          (created.ok === true ||
            (created.ok === false && created.status === 'needs_confirm')),
        'native create-only skill upload returned an invalid result',
      );
      // A racing identical create is reusable; a different one fails byte
      // verification. Never send force/overwrite consent, even after a conflict.
      insist(
        !(await verifySkills(true)).includes(slug),
        'native skill creation did not persist',
      );
    }
  }
  const target = {
    origin: origin.origin,
    orgId: options.orgId,
    projectId: options.projectId,
    automationName: manifest.automationName,
  };
  const sameTarget =
    previous && stableJson(previous.target) === stableJson(target)
      ? previous
      : undefined;
  const matches =
    sameTarget &&
    (sameTarget.releaseRef ?? sameTarget.configVersion) === identity &&
    sameTarget.artifactSha256 === manifest.artifact.sha256;
  const save = (version: number, status: 'saved' | 'deployed'): void => {
    const rollback =
      sameTarget && !matches
        ? {
            ...(sameTarget.releaseRef === undefined
              ? { configVersion: sameTarget.configVersion }
              : { releaseRef: sameTarget.releaseRef }),
            artifactSha256: sameTarget.artifactSha256,
            automationVersion: sameTarget.automationVersion,
          }
        : sameTarget?.previous;
    const receipt = {
      schemaVersion: manifest.schemaVersion === 4 ? 2 : 1,
      target,
      ...result,
      automationVersion: version,
      status,
      ...(rollback ? { previous: rollback } : {}),
    };
    mkdirSync(path.dirname(receiptPath), { recursive: true });
    const temporary = `${receiptPath}.tmp.${randomUUID()}`;
    writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    renameSync(temporary, receiptPath);
  };
  let version: number | undefined;
  let unchanged = false;
  if (matches) {
    const current = await verifyNative(sameTarget.automationVersion, false);
    version = current.version;
    unchanged = current.deployedVersion === version;
  } else {
    const retained =
      sameTarget &&
      sameTarget.previous &&
      (sameTarget.previous?.releaseRef ??
        sameTarget.previous?.configVersion) === identity &&
      sameTarget.previous.artifactSha256 === manifest.artifact.sha256
        ? sameTarget.previous.automationVersion
        : undefined;
    const requested = options.automationVersion ?? retained;
    const candidate = await request(
      requested === undefined
        ? automationPath
        : `${automationPath}?version=${requested}`,
      { allowNotFound: true },
    );
    if (candidate?.version) {
      let current: (Reply & { version: number }) | undefined;
      try {
        current = await verifyNative(candidate.version, false);
      } catch (error) {
        if (!(error instanceof ContentMismatch)) throw error;
      }
      if (current) {
        // v0.5.16 has no saved-version task-contract read endpoint. A matching
        // unpublished workflow without our receipt is insufficient custody.
        insist(
          current.deployedVersion === current.version ||
            retained === current.version,
          'unreceipted unpublished native version requires operator recovery: task contract cannot be verified before deployment; no import or deployment performed',
        );
        if (current.deployedVersion === current.version)
          await verifyNative(current.version, true);
        version = current.version;
        unchanged = current.deployedVersion === version;
        save(version, unchanged ? 'deployed' : 'saved');
      }
    }
  }
  if (version === undefined) {
    insist(
      manifest.schemaVersion !== 1 && installation,
      'legacy skill and automation uploads are forbidden; specify an existing matching native automationVersion',
    );
    // This transport carries zero skills. Skill ownership writes use the
    // dedicated locked create-only lane above, avoiding full-pack overwrite races.
    const staged = await request(
      '/api/app/files/upload?purpose=automation_bundle',
      { method: 'POST', raw: true, body: installation.workflow.bytes },
    );
    insist(staged?.storageId, 'native upload did not return a storage ID');
    const uploaded = await request('/api/app/automations/upload', {
      method: 'POST',
      body: { projectId: options.projectId, storageId: staged.storageId },
    });
    insist(
      !(uploaded?.ok === false && uploaded.status === 'needs_confirm'),
      'workflow-only import must not request skill writes',
    );
    insist(
      uploaded?.ok === true &&
        uploaded.name === manifest.automationName &&
        integer(uploaded.version),
      'native import did not return the expected automation version',
    );
    insist(
      uploaded.warnings?.length === 0,
      'native import returned warnings; review the Tale version before deploying',
    );
    insist(
      uploaded.skills?.length === 0,
      'workflow-only import must not write any skills',
    );
    version = uploaded.version;
    save(version, 'saved');
    await verifyNative(version, false);
  }
  if (!unchanged) {
    const deployed = await request(`${automationPath}/deploy`, {
      method: 'POST',
      body: { version },
    });
    insist(
      deployed?.name === manifest.automationName &&
        deployed.version === version,
      'native deploy returned an unexpected version',
    );
  }
  await verifyNative(version, true);
  save(version, 'deployed');
  return { ...result, automationVersion: version, unchanged };
}
export const deployRelease = (options: DeployOptions): Promise<RecordValue> =>
  apply(options, false);
/** No uploads, deployment, receipt writes or version creation. */
export const verifyRelease = (options: DeployOptions): Promise<RecordValue> =>
  apply(options, true);
