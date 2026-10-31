import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { imageRef, type ServiceConfig } from '../compose/types';
import { getProjectId } from '../project/project-context';
import type { AutomationWriterProtocol } from './automation-model';
import {
  bundledBackendIdentity,
  imageWriterProtocol,
  installedAutomationProtocol,
  protocolRead,
  requireAutomationProtocol,
} from './automation-protocol';
import {
  requireRuntime,
  revisionSchema,
  type RuntimeDependencies,
} from './runtime-model';
import { imageInspectSchema } from './runtime-prepare';

/** The deployment's bundled database container, created or not; none on an
 * empty host. More than one is never guessed between. */
export async function tagDatabaseId(
  project: string,
  dependencies: RuntimeDependencies = {},
): Promise<string | null> {
  const ids = (
    await protocolRead(
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--filter',
        'label=com.docker.compose.service=db',
        '--format',
        '{{.ID}}',
      ],
      dependencies,
    )
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  requireRuntime(
    ids.length <= 1 && ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
    'The installed automation writer protocol requires one unambiguous database.',
  );
  return ids[0] ?? null;
}

/** No hidden database start and no container-name guess on an existing host. */
export async function tagDeploymentProtocol(
  project: string,
  existing: boolean,
  dependencies: RuntimeDependencies = {},
): Promise<AutomationWriterProtocol> {
  requireRuntime(
    /^[a-z][a-z0-9-]{0,62}$/.test(project),
    'Invalid deployment project.',
  );
  requireRuntime(
    !process.env.DATABASE_URL &&
      (!process.env.APP_DB_NAME || process.env.APP_DB_NAME === 'tale_app'),
    'Custom database connections require a separately verified protocol readback. This CLI cannot safely deploy or roll back that topology.',
  );
  const database = await tagDatabaseId(project, dependencies);
  if (database !== null) {
    const before = await bundledBackendIdentity(
      [project, `${project}-blue`, `${project}-green`],
      dependencies,
    );
    const floor = await installedAutomationProtocol(
      database,
      project,
      dependencies,
    );
    requireRuntime(
      before.identity ===
        (
          await bundledBackendIdentity(
            [project, `${project}-blue`, `${project}-green`],
            dependencies,
          )
        ).identity,
      'Installed backend database identity changed during admission.',
    );
    return before.protocol === 2 ? 2 : floor;
  }
  for (const owner of [project, `${project}-blue`, `${project}-green`])
    requireRuntime(
      (
        await protocolRead(
          [
            'ps',
            '-a',
            '--no-trunc',
            '--filter',
            `label=com.docker.compose.project=${owner}`,
            '--format',
            '{{.ID}}',
          ],
          dependencies,
        )
      ).trim() === '',
      'The installed automation writer protocol cannot be established without the existing database.',
    );
  const raw = await protocolRead(
    ['volume', 'ls', '--format', '{{json .}}'],
    dependencies,
  );
  const volumes = raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) =>
      z.object({ Name: z.string().min(1) }).parse(JSON.parse(line)),
    );
  requireRuntime(
    !existing &&
      !volumes.some((volume) => volume.Name.startsWith(`${project}_`)),
    'The installed automation writer protocol cannot be established without the existing database.',
  );
  return 1;
}

/** Return the immutable platform reference admitted for all three backend roles.
 * `legacyCutover` is `tale deploy`'s: it admits a protocol-2 image over an
 * existing protocol-1 database because it runs the cutover barrier itself
 * (`tag-automation-cutover.ts`) before that image starts. Rollback never does. */
export async function admitTagAutomationImage(
  config: ServiceConfig,
  installed: AutomationWriterProtocol,
  dependencies: RuntimeDependencies = {},
  admission: { legacyCutover?: boolean } = {},
): Promise<string | undefined> {
  const reference = imageRef(config, 'platform');
  let inspected: string;
  try {
    inspected = await protocolRead(
      ['image', 'inspect', reference],
      dependencies,
    );
  } catch {
    // protocolRead's own sentence is about the installed writer; this read is
    // the selected image's, so name the image and the read instead.
    throw externalDepError(
      `Could not read the automation writer protocol of the selected image: \`docker image inspect ${reference}\` failed.`,
    );
  }
  const [image] = z
    .array(
      imageInspectSchema.extend({
        Id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    .length(1)
    .parse(JSON.parse(inspected));
  const protocol = imageWriterProtocol(image.Config.Labels);
  requireAutomationProtocol(installed, protocol);
  if (protocol === 1) return undefined;
  if (installed === 1 && admission.legacyCutover !== true) {
    // Only a deploy that runs the cutover barrier may start a protocol-2
    // writer beside an existing protocol-1 database. Empty-host installs are
    // safe; rollback has no barrier and never crosses the cutover.
    const databases = await protocolRead(
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        'label=com.docker.compose.service=db',
        '--filter',
        `label=com.docker.compose.project=${getProjectId()}`,
        '--format',
        '{{.ID}}',
      ],
      dependencies,
    );
    requireRuntime(
      databases.trim() === '',
      'An existing protocol-1 database crosses the automation writer protocol cutover only through `tale deploy` (or managed deployment apply), which runs the cutover barrier; rollback cannot cross it.',
    );
  }
  const repository = `${config.registry}/tale-platform`;
  const digests = [
    ...new Set(
      image.RepoDigests.filter(
        (digest) =>
          digest.startsWith(`${repository}@`) &&
          /^sha256:[a-f0-9]{64}$/.test(digest.slice(repository.length + 1)),
      ),
    ),
  ];
  const labels = image.Config.Labels;
  requireRuntime(
    image.Os === 'linux' &&
      ['amd64', 'arm64'].includes(image.Architecture) &&
      revisionSchema.safeParse(labels?.['org.opencontainers.image.revision'])
        .success &&
      labels?.['org.opencontainers.image.version'] === config.version &&
      labels['org.opencontainers.image.source'] ===
        'https://github.com/tale-project/tale' &&
      digests.length === 1,
    'Selected image does not prove its automation writer protocol, source, version and repository digest.',
  );
  // A mutable tag cannot be substituted after inspection. Compose consumes this.
  return digests[0];
}

/** Resume inspects every already-created writer, not merely the newly pulled tag. */
export async function admitPendingAutomationColor(
  project: string,
  platformImage: string | undefined,
  installed: AutomationWriterProtocol,
  dependencies: RuntimeDependencies = {},
): Promise<void> {
  if (installed === 1 && platformImage === undefined) return;
  requireRuntime(
    platformImage,
    'Pending deployment has no admitted automation image.',
  );
  const [target] = z
    .array(z.object({ Id: z.string().regex(/^sha256:[a-f0-9]{64}$/) }))
    .length(1)
    .parse(
      JSON.parse(
        await protocolRead(['image', 'inspect', platformImage], dependencies),
      ),
    );
  const ids = (
    await protocolRead(
      [
        'ps',
        '-a',
        '--no-trunc',
        '--filter',
        `label=com.docker.compose.project=${project}`,
        '--format',
        '{{.ID}}',
      ],
      dependencies,
    )
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  requireRuntime(
    ids.length > 0 &&
      ids.length <= 64 &&
      new Set(ids).size === ids.length &&
      ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
    'Pending automation writer inventory is incomplete.',
  );
  const containers = z
    .array(
      z.object({
        Id: z.string(),
        Image: z.string(),
        Config: z.object({ Labels: z.record(z.string(), z.string()) }),
      }),
    )
    .length(ids.length)
    .parse(
      JSON.parse(
        await protocolRead(['container', 'inspect', ...ids], dependencies),
      ),
    );
  requireRuntime(
    new Set(containers.map((c) => c.Id)).size === ids.length &&
      containers.every((c) => ids.includes(c.Id)),
    'Pending writer identity changed.',
  );
  for (const service of ['platform', 'backend-api', 'backend-worker']) {
    const matches = containers.filter(
      (c) => c.Config.Labels['com.docker.compose.service'] === service,
    );
    requireRuntime(
      matches.length > 0 &&
        matches.every(
          (c) =>
            c.Image === target.Id &&
            c.Config.Labels['com.docker.compose.project'] === project &&
            /^[1-9][0-9]*$/.test(
              c.Config.Labels['com.docker.compose.container-number'] ?? '',
            ) &&
            c.Config.Labels['com.docker.compose.oneoff']?.toLowerCase() ===
              'false',
        ),
      'Pending automation writer differs from the admitted image. Use a compatible forward repair.',
    );
  }
}
