import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { CliError, preconditionError } from '../../utils/fail';
import { createNativeHttp, type NativeFetch } from '../config/native-http';
import { verifyRelease } from '../config/releases/deploy';
import { loadClient, stableJson, valueHash } from '../config/releases/identity';
import { loadRelease } from '../config/releases/manifest';
import { relativePath, sha, slug } from '../config/releases/model';
import { verifyStage } from '../config/releases/stage';
import { configureInstance } from './identity';
import {
  ObservationCleanupError,
  observationPhases,
  type SetObservationPhase,
} from './observation-errors';
import { observationFile } from './observation-files';
import { observationHttp } from './observation-http';
import {
  nativeObservationInputSchema,
  nativeObservationResultSchema,
  retainedReceiptSchema,
} from './observation-model';
import {
  nativeDeploymentStateDirectory,
  readProvisionStateProof,
} from './provision-state';

const metadataSchema = z.object({
  clientId: slug,
  automationName: slug,
  artifactSha256: sha,
  files: z
    .array(
      z.object({
        path: relativePath,
        bytes: z
          .number()
          .int()
          .nonnegative()
          .max(64 * 1024 * 1024),
        sha256: sha,
      }),
    )
    .min(2)
    .max(4096),
});
function directoryEntries(directory: string) {
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid &&
      (info.uid !== process.getuid() || (info.mode & 0o022) !== 0))
  )
    throw preconditionError(
      'Retained observation directory has unsafe custody.',
    );
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.length > 128)
    throw preconditionError(
      'Retained observation inventory exceeds its bound.',
    );
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
const unavailable = (
  reason:
    | 'retained_state_missing'
    | 'retained_stage_missing'
    | 'retained_receipt_missing'
    | 'retained_owner_missing'
    | 'native_owner_unavailable',
) => ({ status: 'unavailable' as const, reason });
interface NativeObservationDependencies {
  dataDirectory?: string;
  fetch?: NativeFetch;
  now?: () => number;
}

/** Existing native state and GETs only. Never prepare a source capsule, validate
 * an old workflow with a new compiler, deploy a release or write a receipt. */
export async function observeNativeDeployment(
  raw: unknown,
  dependencies: NativeObservationDependencies = {},
) {
  return observationPhases('nativeInput', (phase) =>
    readNativeDeployment(raw, dependencies, phase),
  );
}

async function readNativeDeployment(
  raw: unknown,
  dependencies: NativeObservationDependencies,
  phase: SetObservationPhase,
) {
  const input = nativeObservationInputSchema.parse(raw);
  const now = dependencies.now ?? performance.now.bind(performance);
  const started = now();
  phase('nativeState');
  let state: string;
  try {
    state = nativeDeploymentStateDirectory(
      dependencies.dataDirectory ?? '/app/data',
      input.target.name,
      false,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return unavailable('retained_state_missing');
    throw error;
  }
  const stateNames = directoryEntries(state).map((entry) => entry.name);
  phase('nativeJournal');
  const configuration = readProvisionStateProof(
    join(state, 'configuration.json'),
    z.object({ phase: z.enum(['pending', 'ready']) }),
    1_048_576,
  );
  if (configuration?.value.phase === 'pending')
    throw preconditionError(
      'An unfinished native configuration prevents observation.',
    );
  const records = [];
  const receiptInventories = new Map<string, string[]>();
  phase('nativeInventory');
  for (const entry of directoryEntries(state)) {
    phase('nativeInventory');
    if (entry.isSymbolicLink())
      throw preconditionError(
        'Retained native inventory contains a symbolic link.',
      );
    if (
      !entry.isDirectory() ||
      entry.name === 'private' ||
      entry.name === 'compiled'
    )
      continue;
    slug.parse(entry.name);
    phase('nativeReceiptInventory');
    const receiptDirectory = join(state, entry.name);
    const entries = directoryEntries(receiptDirectory);
    receiptInventories.set(
      receiptDirectory,
      entries.map((file) => file.name),
    );
    for (const file of entries) {
      phase('nativeReceiptInventory');
      if (!file.isFile() || !file.name.endsWith('.json'))
        throw preconditionError(
          'Retained configuration inventory is ambiguous.',
        );
      const name = slug.parse(file.name.slice(0, -5));
      const path = join(state, entry.name, file.name);
      phase('nativeReceipt');
      const proof = readProvisionStateProof(
        path,
        retainedReceiptSchema,
        262_144,
      );
      phase('nativeReceiptTarget');
      if (
        !proof ||
        proof.value.target.automationName !== name ||
        proof.value.target.orgId !== input.target.organizationId ||
        proof.value.target.origin !== input.target.origin
      )
        throw preconditionError(
          'Retained configuration differs from the observed native target.',
        );
      phase('nativeReceiptInventory');
      records.push({ client: entry.name, path, proof });
      if (records.length > 64)
        throw preconditionError(
          'Retained configuration count exceeds its bound.',
        );
    }
  }
  if (records.length === 0) return unavailable('retained_receipt_missing');
  phase('nativeArtifacts');
  let stages;
  try {
    stages = directoryEntries(join(state, 'compiled'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return unavailable('retained_stage_missing');
    throw error;
  }
  const candidates = stages.map((entry) => {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw preconditionError('Retained stage inventory has unsafe custody.');
    const directory = join(state, 'compiled', entry.name);
    const file = observationFile(join(directory, 'deployment.json'), 1_048_576);
    return {
      directory,
      file,
      metadata: metadataSchema.parse(JSON.parse(file.bytes.toString('utf8'))),
    };
  });
  const captured: {
    record: (typeof records)[number];
    candidate: (typeof candidates)[number];
    files: { path: string; bytes: number; sha256: string }[];
    stage: ReturnType<typeof verifyStage>;
    release: ReturnType<typeof loadRelease>;
  }[] = [];
  const allowedReads = new Set([
    '/api/auth/get-session',
    '/api/auth/organization/list',
    '/api/app/automations/listing',
  ]);
  let total = 0;
  for (const record of records) {
    const receipt = record.proof.value;
    const matching = candidates.filter(
      ({ metadata }) =>
        metadata.clientId === record.client &&
        metadata.automationName === receipt.target.automationName &&
        metadata.artifactSha256 === receipt.artifactSha256,
    );
    if (matching.length === 0) return unavailable('retained_stage_missing');
    if (matching.length !== 1)
      throw preconditionError(
        'Retained configuration has more than one matching stage.',
      );
    const candidate = matching[0];
    const files = candidate.metadata.files.map((file) => {
      total += file.bytes;
      if (total > 128 * 1024 * 1024)
        throw preconditionError(
          'Retained artifact inventory exceeds its byte budget.',
        );
      const absolute = join(candidate.directory, file.path);
      const artifact = observationFile(absolute, file.bytes);
      if (
        artifact.bytes.length !== file.bytes ||
        artifact.sha256 !== file.sha256
      )
        throw preconditionError(
          'Retained artifact bytes differ from their stage.',
        );
      return { path: absolute, bytes: file.bytes, sha256: artifact.sha256 };
    });
    const stage = verifyStage(candidate.directory, {
      clientId: record.client,
      automationName: receipt.target.automationName,
      sourceCommit: receipt.sourceCommit,
      releaseRef: receipt.releaseRef,
      configVersion: receipt.configVersion,
      artifactSha256: receipt.artifactSha256,
    });
    const release = loadRelease(
      stage.manifestPath,
      loadClient(stage.descriptorPath, stage.automationName),
    );
    if (
      release.manifest.skillSlugs.length > 0 &&
      !release.manifest.skillOwnerUserId
    )
      return unavailable('retained_owner_missing');
    if (
      release.manifest.skillOwnerUserId &&
      release.manifest.skillOwnerUserId !== input.target.userId
    )
      throw preconditionError(
        'Retained skill owner differs from the captured operator identity.',
      );
    for (const suffix of ['', '/projects'])
      allowedReads.add(
        `/api/app/automations/${encodeURIComponent(stage.automationName)}${suffix}`,
      );
    for (const name of [
      ...release.manifest.skillSlugs,
      ...(release.manifest.requiredExternalSkills ?? []),
    ])
      allowedReads.add(`/api/app/skills/${encodeURIComponent(name)}`);
    for (const file of release.manifest.skillFiles)
      allowedReads.add(
        `/api/app/skills/${encodeURIComponent(file.slug)}/assets/${file.path.split('/').map(encodeURIComponent).join('/')}`,
      );
    captured.push({ record, candidate, files, stage, release });
  }
  const budget = input.budgetMs - (now() - started);
  if (budget < 6000)
    throw preconditionError(
      'Native custody reads exhausted the observation budget.',
    );
  const http = observationHttp(allowedReads, dependencies.fetch, now, budget);
  const results: unknown[] = [];
  let missingNativeOwner = false;
  phase('nativeAuthentication');
  try {
    await configureInstance(
      {
        origin: input.target.origin,
        email: input.operator.email,
        password: input.operator.password,
        slug: input.target.organizationSlug,
        name: input.target.organizationName,
        ssoEnabled: false,
      },
      {
        existingOnly: {
          userId: input.target.userId,
          organizationId: input.target.organizationId,
        },
        fetchImpl: (url, init) => http.request(url, init),
        provision: async (context) => {
          phase('nativeVerification');
          const cookie = context.headers().get('cookie');
          if (!cookie)
            throw preconditionError('Native observation session is missing.');
          const reader = createNativeHttp({
            url: context.baseUrl,
            origin: context.origin,
            orgId: context.organization.id,
            cookie,
            fetchImpl: (url, init) => http.request(url, init),
          });
          for (const { record, stage, release, candidate } of captured) {
            const proof = await verifyRelease({
              descriptorPath: stage.descriptorPath,
              manifestPath: stage.manifestPath,
              automationName: stage.automationName,
              url: context.baseUrl,
              origin: context.origin,
              orgId: context.organization.id,
              projectId: record.proof.value.target.projectId,
              cookie,
              automationVersion: record.proof.value.automationVersion,
              requireDeployed: true,
              fetchImpl: (url, init) => http.request(url, init),
            });
            const pointer = z
              .object({
                name: z.literal(stage.automationName),
                version: z.literal(record.proof.value.automationVersion),
                deployedVersion: z.literal(
                  record.proof.value.automationVersion,
                ),
              })
              .safeParse(
                await reader.request(
                  `/api/app/automations/${encodeURIComponent(stage.automationName)}`,
                ),
              );
            if (!pointer.success)
              throw preconditionError(
                'Native current version changed during observation.',
              );
            const owners = [];
            for (const skillSlug of release.manifest.skillSlugs) {
              const skill = z
                .object({
                  skill: z.object({
                    slug: z.literal(skillSlug),
                    owner: z.string().min(1).max(128).optional(),
                  }),
                })
                .parse(
                  await reader.request(
                    `/api/app/skills/${encodeURIComponent(skillSlug)}`,
                  ),
                );
              if (
                skill.skill.owner &&
                release.manifest.skillOwnerUserId &&
                skill.skill.owner !== release.manifest.skillOwnerUserId
              )
                throw preconditionError(
                  'Native skill owner differs from retained custody.',
                );
              if (!skill.skill.owner) missingNativeOwner = true;
              owners.push({
                slug: skillSlug,
                liveOwnerUserId: skill.skill.owner ?? null,
              });
            }
            results.push({
              clientId: record.client,
              automationName: stage.automationName,
              projectId: record.proof.value.target.projectId,
              receiptSha256: record.proof.sha256,
              stageSha256: candidate.file.sha256,
              sourceCommit: release.manifest.sourceCommit,
              artifactSha256: release.manifest.artifact.sha256,
              automationVersion: proof.automationVersion,
              workflowSha256: release.manifest.documentSha256,
              skillInventorySha256: valueHash(release.manifest.skillFiles),
              ownedSkillFiles: release.manifest.skillFiles.length,
              custodyOwnerUserId: release.manifest.skillOwnerUserId ?? null,
              skillOwners: owners,
            });
          }
        },
      },
    );
  } catch (error) {
    if (
      error instanceof CliError &&
      [
        'Temporary native session cleanup failed.',
        'Native instance provisioning failed; temporary session cleanup also failed.',
      ].includes(error.info.summary)
    )
      throw new ObservationCleanupError('session');
    throw preconditionError(
      'Retained native configuration verification failed; no configuration was changed.',
    );
  }
  phase('nativeStability');
  if (http.remaining() <= 0)
    throw preconditionError('Native observation exceeded its deadline.');
  if (
    stableJson(directoryEntries(state).map((entry) => entry.name)) !==
    stableJson(stateNames)
  )
    throw preconditionError(
      'Retained native inventory changed during observation.',
    );
  for (const [directory, names] of receiptInventories)
    if (
      stableJson(directoryEntries(directory).map((entry) => entry.name)) !==
      stableJson(names)
    )
      throw preconditionError(
        'Retained receipt inventory changed during observation.',
      );
  if (
    stableJson(
      directoryEntries(join(state, 'compiled')).map((entry) => entry.name),
    ) !== stableJson(stages.map((entry) => entry.name))
  )
    throw preconditionError(
      'Retained stage inventory changed during observation.',
    );
  for (const { record, candidate, files } of captured) {
    if (
      readProvisionStateProof(record.path, retainedReceiptSchema, 262_144)
        ?.sha256 !== record.proof.sha256 ||
      observationFile(join(candidate.directory, 'deployment.json'), 1_048_576)
        .sha256 !== candidate.file.sha256 ||
      files.some(
        (file) => observationFile(file.path, file.bytes).sha256 !== file.sha256,
      )
    )
      throw preconditionError(
        'Retained native custody changed during observation.',
      );
  }
  if (
    readProvisionStateProof(
      join(state, 'configuration.json'),
      z.object({ phase: z.enum(['pending', 'ready']) }),
      1_048_576,
    )?.sha256 !== configuration?.sha256
  )
    throw preconditionError(
      'Native configuration state changed during observation.',
    );
  if (now() - started >= input.budgetMs)
    throw preconditionError('Native observation exceeded its deadline.');
  if (missingNativeOwner) return unavailable('native_owner_unavailable');
  return nativeObservationResultSchema.parse({
    status: 'observed',
    identity: input.target,
    configurations: results,
    claim:
      'Retained artifact, current native version and owned asset bytes verified; no deployment or cutover authorization.',
  });
}
