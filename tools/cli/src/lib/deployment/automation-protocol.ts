import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import { stableJson } from '../config/releases/identity';
import { exec } from '../docker/exec';
import { migrationReadScript } from './acceptance-migrations';
import { AUTOMATION_FLOOR_SQL, automationFloor } from './automation-floor';
import {
  AUTOMATION_PROTOCOL_LABEL,
  type AutomationWriterProtocol,
} from './automation-model';
import { runtimeProcessEnvironment } from './runtime-command';
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

const databaseIdentitySchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  RestartCount: z.number().int().nonnegative(),
  Config: z.object({
    Image: z.string().min(1),
    Labels: z.record(z.string(), z.string()),
  }),
  State: z.object({ Running: z.literal(true), StartedAt: z.string().min(1) }),
});

/** Existing bounded executor, fixed labels, and no ambient database credentials. */
export async function protocolRead(
  args: string[],
  dependencies: RuntimeDependencies,
  stdin?: string,
): Promise<string> {
  try {
    const result = await (dependencies.exec ?? exec)('docker', args, {
      silent: true,
      timeout: 15,
      maxOutputBytes: 1_048_576,
      env: runtimeProcessEnvironment(),
      ...(stdin === undefined ? {} : { stdin }),
    });
    if (!result.success) throw new Error('read refused');
    return result.stdout;
  } catch {
    throw externalDepError(
      'The installed automation writer protocol could not be read safely.',
    );
  }
}

/** Capture and reread one already running, custody-checked DB incarnation. */
export async function installedAutomationProtocol(
  containerId: string,
  project: string,
  dependencies: RuntimeDependencies,
): Promise<AutomationWriterProtocol> {
  try {
    requireRuntime(
      /^[a-f0-9]{64}$/.test(containerId),
      'Invalid automation protocol database identity.',
    );
    const identity = async () => {
      const [value] = z
        .array(databaseIdentitySchema)
        .length(1)
        .parse(
          JSON.parse(
            await protocolRead(
              ['container', 'inspect', containerId],
              dependencies,
            ),
          ),
        );
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
    const raw = await protocolRead(
      ['exec', '-i', containerId, 'sh', '-s'],
      dependencies,
      migrationReadScript('db', AUTOMATION_FLOOR_SQL),
    );
    const floor = automationFloor(raw);
    requireRuntime(
      stableJson(before) === stableJson(await identity()),
      'Automation protocol database changed during admission.',
    );
    return floor;
  } catch {
    throw preconditionError(
      'The installed automation writer protocol is unknown. Keep the existing runtime and repair its database readback before deployment.',
    );
  }
}

const backendIdentitySchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  RestartCount: z.number().int().nonnegative(),
  State: z.object({ Running: z.boolean(), StartedAt: z.string() }),
  Config: z.object({
    Labels: z.record(z.string(), z.string()),
    Env: z.array(z.string()).max(2048),
  }),
});

/** The installed connection matters even after its old .env override is removed.
 * Docker output stays in the bounded silent reader; credentials are never emitted.
 * Custom/external connections need their own proven DB custody path, not this one. */
export async function bundledBackendIdentity(
  projects: readonly string[],
  dependencies: RuntimeDependencies,
): Promise<{ identity: string; protocol: AutomationWriterProtocol }> {
  const ids: string[] = [];
  requireRuntime(
    projects.length > 0 &&
      projects.length <= 3 &&
      projects.every((project) => /^[a-z][a-z0-9-]{0,68}$/.test(project)),
    'Invalid backend custody projects.',
  );
  for (const owner of projects) {
    ids.push(
      ...(
        await protocolRead(
          [
            'ps',
            '-a',
            '--no-trunc',
            '--filter',
            `label=com.docker.compose.project=${owner}`,
            '--format',
            '{{.ID}}\t{{.Label "com.docker.compose.service"}}',
          ],
          dependencies,
        )
      )
        .trim()
        .split('\n')
        .filter(Boolean)
        .flatMap((line) => {
          const columns = line.split('\t');
          requireRuntime(
            columns.length === 2 && /^[a-f0-9]{64}$/.test(columns[0]),
            'Installed backend inventory is malformed.',
          );
          return ['backend-api', 'backend-worker'].includes(columns[1])
            ? [columns[0]]
            : [];
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
      .parse(
        JSON.parse(
          await protocolRead(['container', 'inspect', ...ids], dependencies),
        ),
      );
  } catch {
    // Docker metadata contains credentials. Do not render JSON parser context
    // or validation payloads through the CLI's generic failure boundary.
    throw preconditionError(
      'The installed backend database metadata is unreadable. Keep the existing runtime.',
    );
  }
  requireRuntime(
    new Set(values.map((v) => v.Id)).size === ids.length &&
      values.every((v) => ids.includes(v.Id)),
    'Installed backend identities changed.',
  );
  for (const value of values) {
    const labels = value.Config.Labels;
    const connections = value.Config.Env.filter((entry) =>
      entry.startsWith('DATABASE_URL='),
    );
    requireRuntime(
      projects.includes(labels['com.docker.compose.project']) &&
        ['backend-api', 'backend-worker'].includes(
          labels['com.docker.compose.service'],
        ) &&
        /^[1-9][0-9]*$/.test(
          labels['com.docker.compose.container-number'] ?? '',
        ) &&
        labels['com.docker.compose.oneoff']?.toLowerCase() === 'false' &&
        connections.length === 1,
      'Installed backend database custody differs.',
    );
    let bundled = false;
    try {
      const url = new URL(connections[0].slice('DATABASE_URL='.length));
      bundled =
        ['postgres:', 'postgresql:'].includes(url.protocol) &&
        url.hostname === 'db' &&
        url.port === '5432' &&
        url.pathname === '/tale_app' &&
        url.search === '' &&
        url.hash === '' &&
        url.username !== '';
    } catch {
      /* An unreadable connection is never the default database. */
    }
    requireRuntime(
      bundled,
      'Custom database connections require a separately verified protocol readback. This CLI cannot safely deploy or roll back that topology.',
    );
  }
  for (const role of ['backend-api', 'backend-worker'])
    requireRuntime(
      values.some(
        (v) => v.Config.Labels['com.docker.compose.service'] === role,
      ),
      'The installed backend database inventory is incomplete.',
    );
  // A created writer can still finish its first migration or be restarted. Its
  // immutable image therefore raises the floor even before the ledger commits.
  const imageIds = [...new Set(values.map((value) => value.Image))].sort();
  let images: Array<{
    Id: string;
    Config: { Labels?: Record<string, string> | null };
  }>;
  try {
    images = z
      .array(
        z.object({
          Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          Config: z.object({
            Labels: z.record(z.string(), z.string()).nullish(),
          }),
        }),
      )
      .length(imageIds.length)
      .parse(
        JSON.parse(
          await protocolRead(['image', 'inspect', ...imageIds], dependencies),
        ),
      );
  } catch {
    throw preconditionError(
      'Installed backend image capability is unreadable. Keep the existing runtime.',
    );
  }
  requireRuntime(
    new Set(images.map((image) => image.Id)).size === imageIds.length &&
      images.every((image) => imageIds.includes(image.Id)),
    'Installed backend image identity changed.',
  );
  const capabilities = images
    .map((image) => ({
      id: image.Id,
      protocol: imageWriterProtocol(image.Config.Labels),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const protocol = capabilities.some((image) => image.protocol === 2) ? 2 : 1;
  // Compare only the owned identities and connection, never unrelated secrets.
  return {
    protocol,
    identity: stableJson({
      capabilities,
      containers: values
        .map((v) => ({
          Id: v.Id,
          Image: v.Image,
          RestartCount: v.RestartCount,
          State: v.State,
          Config: {
            Labels: v.Config.Labels,
            Env: v.Config.Env.filter((e) => e.startsWith('DATABASE_URL=')),
          },
        }))
        .sort((a, b) => a.Id.localeCompare(b.Id)),
    }),
  };
}
