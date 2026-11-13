import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { stableJson } from '../config/releases/identity';
import { migrationReadScript } from './acceptance-migrations';
import {
  AUTOMATION_FLOOR_SQL,
  type AutomationLedger,
  automationLedger,
  ledgerFloor,
} from './automation-floor';
import {
  AUTOMATION_PROTOCOL_LABEL,
  type AutomationWriterProtocol,
} from './automation-model';
import {
  budgetedDockerRun,
  dockerRuntimeAccess,
  type RuntimeAccess,
  type RuntimeInstance,
} from './runtime-access';
import { requireRuntime, type RuntimeDependencies } from './runtime-model';

/** Missing metadata is an old image, never evidence of the new writer. */
export function imageWriterProtocol(
  labels: Record<string, string> | null | undefined,
): AutomationWriterProtocol {
  const value = labels?.[AUTOMATION_PROTOCOL_LABEL];
  requireRuntime(
    value === undefined || value === '1' || value === '2',
    'Selected image has an unsupported automation writer protocol.',
  );
  return value === '2' ? 2 : 1;
}

export function requireAutomationProtocol(
  installed: AutomationWriterProtocol,
  target: AutomationWriterProtocol,
): void {
  requireRuntime(
    target >= installed,
    'The installed automation writer protocol requires a compatible runtime. Use a protocol-compatible forward repair; restoring data cannot undo external effects.',
  );
}

/**
 * The database instance's custody record, in the shape the cutover receipt
 * keeps it (`.tale/automation-cutover.json`): read back as a normalized
 * `RuntimeInstance`, it is checked and written under these keys.
 */
export const databaseIdentitySchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  RestartCount: z.number().int().nonnegative(),
  Config: z.object({
    Image: z.string().min(1),
    Labels: z.record(z.string(), z.string()),
  }),
  State: z.object({ Running: z.literal(true), StartedAt: z.string().min(1) }),
});

/** The database custody record of one read-back instance. */
export function databaseIdentity(instance: RuntimeInstance) {
  return databaseIdentitySchema.parse({
    Id: instance.id,
    Image: instance.image,
    RestartCount: instance.restartCount,
    Config: { Image: instance.imageReference, Labels: instance.labels },
    State: { Running: instance.running, StartedAt: instance.startedAt },
  });
}

const PROTOCOL_READ_FAILURE =
  'The installed automation writer protocol could not be read safely.';

/** Existing bounded executor, fixed labels, and no ambient database
 * credentials: every protocol read is bounded alike and fails with one
 * sentence, never the runtime's own output. */
export function protocolAccess(
  dependencies: RuntimeDependencies,
): RuntimeAccess {
  // On Incus, the stack's own access (it never carries a URL either). Its
  // calls here hand no tag, which every tag type allows.
  if (dependencies.access !== undefined)
    return dependencies.access as unknown as RuntimeAccess;
  return dockerRuntimeAccess(
    budgetedDockerRun(
      {
        bounds: () => ({ timeout: 15, maxOutputBytes: 1_048_576 }),
        failed: () => externalDepError(PROTOCOL_READ_FAILURE),
        refused: () => externalDepError(PROTOCOL_READ_FAILURE),
      },
      { exec: dependencies.exec },
    ),
  );
}

/** Capture and reread one already running, custody-checked DB incarnation. */
export async function installedAutomationProtocol(
  containerId: string,
  project: string,
  dependencies: RuntimeDependencies,
): Promise<AutomationWriterProtocol> {
  return ledgerFloor(
    await installedAutomationLedger(containerId, project, dependencies),
  );
}

/** The installed application ledger behind that floor, read the same way. */
export async function installedAutomationLedger(
  containerId: string,
  project: string,
  dependencies: RuntimeDependencies,
): Promise<AutomationLedger> {
  try {
    requireRuntime(
      /^[a-f0-9]{64}$/.test(containerId),
      'Invalid automation protocol database identity.',
    );
    const runtime = protocolAccess(dependencies);
    const identity = async () => {
      const [instance, ...others] = await runtime.inspect([containerId]);
      requireRuntime(
        instance && others.length === 0,
        'Automation protocol database custody differs.',
      );
      const value = databaseIdentity(instance);
      const labels = value.Config.Labels;
      requireRuntime(
        value.Id === containerId &&
          labels['com.docker.compose.project'] === project &&
          labels['com.docker.compose.service'] === 'db' &&
          labels['com.docker.compose.container-number'] === '1' &&
          labels['com.docker.compose.oneoff']?.toLowerCase() === 'false',
        'Automation protocol database custody differs.',
      );
      return value;
    };
    const before = await identity();
    const raw = (
      await runtime.exec(containerId, ['sh', '-s'], {
        stdin: migrationReadScript('db', AUTOMATION_FLOOR_SQL),
      })
    ).stdout;
    const ledger = automationLedger(raw);
    requireRuntime(
      stableJson(before) === stableJson(await identity()),
      'Automation protocol database changed during admission.',
    );
    return ledger;
  } catch {
    throw preconditionError(
      'The installed automation writer protocol is unknown. Keep the existing runtime and repair its database readback before deployment.',
    );
  }
}

/** What the writer census demands of a backend instance's readback. */
const backendIdentitySchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  restartCount: z.number().int().nonnegative(),
  running: z.boolean(),
  startedAt: z.string(),
  pid: z.number().int().nonnegative().optional(),
  status: z.string().optional(),
  dead: z.boolean().optional(),
  restartPolicy: z.string().optional(),
  labels: z.record(z.string(), z.string()),
  environmentSize: z.number().int().max(2048),
  bundledDatabase: z.boolean(),
});

/** The installed connection matters even after its old .env override is removed.
 * Docker output stays in the bounded silent reader; credentials are never emitted.
 * Custom/external connections need their own proven DB custody path, not this one. */
export async function bundledBackendIdentity(
  projects: readonly string[],
  dependencies: RuntimeDependencies,
) {
  const runtime = protocolAccess(dependencies);
  const ids: string[] = [];
  // Compose project names, colour projects included: a project ID may start
  // with a digit (`isValidProjectId`).
  requireRuntime(
    projects.length > 0 &&
      projects.length <= 3 &&
      projects.every((project) => /^[a-z0-9][a-z0-9-]{0,68}$/.test(project)),
    'Invalid backend custody projects.',
  );
  for (const owner of projects) {
    ids.push(
      ...(await runtime.listServices(owner)).flatMap(({ id, service }) => {
        requireRuntime(
          service !== null && /^[a-f0-9]{64}$/.test(id),
          'Installed backend inventory is malformed.',
        );
        return ['backend-api', 'backend-worker'].includes(service) ? [id] : [];
      }),
    );
  }
  requireRuntime(
    ids.length > 0 &&
      ids.length <= 96 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
    'The installed backend database connection is unknown. Keep the existing runtime.',
  );
  let values: Array<z.infer<typeof backendIdentitySchema>>;
  try {
    values = z
      .array(backendIdentitySchema)
      .length(ids.length)
      .parse(await runtime.inspect(ids));
  } catch {
    // Docker metadata contains credentials. Do not render JSON parser context
    // or validation payloads through the CLI's generic failure boundary.
    throw preconditionError(
      'The installed backend database metadata is unreadable. Keep the existing runtime.',
    );
  }
  requireRuntime(
    new Set(values.map((v) => v.id)).size === ids.length &&
      values.every((v) => ids.includes(v.id)),
    'Installed backend identities changed.',
  );
  for (const value of values) {
    const labels = value.labels;
    requireRuntime(
      projects.includes(labels['com.docker.compose.project']) &&
        ['backend-api', 'backend-worker'].includes(
          labels['com.docker.compose.service'],
        ) &&
        /^[1-9][0-9]*$/.test(
          labels['com.docker.compose.container-number'] ?? '',
        ) &&
        labels['com.docker.compose.oneoff']?.toLowerCase() === 'false',
      'Installed backend database custody differs.',
    );
    // The runtime judged the connection where it lives: no URL, and so no
    // password, reaches this process (design R-15).
    requireRuntime(
      value.bundledDatabase,
      'Custom database connections require a separately verified protocol readback. This CLI cannot safely deploy or roll back that topology.',
    );
  }
  for (const role of ['backend-api', 'backend-worker'])
    requireRuntime(
      values.some((v) => v.labels['com.docker.compose.service'] === role),
      'The installed backend database inventory is incomplete.',
    );
  // A created writer can still finish its first migration or be restarted. Its
  // immutable image therefore raises the floor even before the ledger commits.
  const imageIds = [...new Set(values.map((value) => value.image))].sort();
  let images: Array<{ id: string; labels: Record<string, string> | null }>;
  try {
    images = z
      .array(
        z.object({
          id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          // Present, and null for an image without labels.
          labels: z.record(z.string(), z.string()).nullable(),
        }),
      )
      .length(imageIds.length)
      .parse(await runtime.inspectImage(imageIds));
  } catch {
    throw preconditionError(
      'Installed backend image capability is unreadable. Keep the existing runtime.',
    );
  }
  requireRuntime(
    new Set(images.map((image) => image.id)).size === imageIds.length &&
      images.every((image) => imageIds.includes(image.id)),
    'Installed backend image identity changed.',
  );
  const capabilities = images
    .map((image) => ({
      id: image.id,
      protocol: imageWriterProtocol(image.labels),
      revision: image.labels?.['org.opencontainers.image.revision'] ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const protocol: AutomationWriterProtocol = capabilities.some(
    (image) => image.protocol === 2,
  )
    ? 2
    : 1;
  // Compare only the owned identities and connection, never unrelated secrets.
  return {
    protocol,
    writers: values
      .map((v) => ({
        id: v.id,
        image: v.image,
        revision:
          capabilities.find((image) => image.id === v.image)?.revision ?? null,
        protocol:
          capabilities.find((image) => image.id === v.image)?.protocol ?? null,
        restarts: v.restartCount,
        running: v.running,
        pid: v.pid ?? null,
        status: v.status ?? null,
        dead: v.dead ?? null,
        startedAt: v.startedAt,
        restartPolicy: v.restartPolicy ?? null,
        project: v.labels['com.docker.compose.project'],
        service: v.labels['com.docker.compose.service'],
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    identity: stableJson({
      capabilities,
      containers: values
        .map((v) => ({
          id: v.id,
          image: v.image,
          restartCount: v.restartCount,
          state: Object.fromEntries(
            Object.entries({
              running: v.running,
              startedAt: v.startedAt,
              pid: v.pid,
              status: v.status,
              dead: v.dead,
            }).filter(([, entry]) => entry !== undefined),
          ),
          restartPolicy: v.restartPolicy ?? null,
          labels: v.labels,
          bundledDatabase: v.bundledDatabase,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }),
  };
}
