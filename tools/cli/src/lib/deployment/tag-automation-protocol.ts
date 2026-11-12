import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { imageRef, type ServiceConfig } from '../compose/types';
import {
  invalidProjectIdMessage,
  isValidProjectId,
} from '../project/generate-project-id';
import { getProjectId } from '../project/project-context';
import type { AutomationWriterProtocol } from './automation-model';
import {
  bundledBackendIdentity,
  imageWriterProtocol,
  installedAutomationProtocol,
  protocolAccess,
  requireAutomationProtocol,
} from './automation-protocol';
import type { RuntimeImage } from './runtime-access';
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
  const ids = await protocolAccess(dependencies).list({
    stack: project,
    service: 'db',
  });
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
  // The rule `tale init` names projects by: a digit-led ID is a valid one.
  requireRuntime(isValidProjectId(project), invalidProjectIdMessage(project));
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
  const runtime = protocolAccess(dependencies);
  for (const owner of [project, `${project}-blue`, `${project}-green`])
    requireRuntime(
      (await runtime.list({ stack: owner })).length === 0,
      'The installed automation writer protocol cannot be established without the existing database.',
    );
  const volumes = await runtime.listVolumes();
  requireRuntime(
    !existing && !volumes.some((volume) => volume.startsWith(`${project}_`)),
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
  const runtime = protocolAccess(dependencies);
  let inspected: RuntimeImage[];
  try {
    inspected = await runtime.inspectImage([reference]);
  } catch (error) {
    // An answer that does not parse is refused as it is, below.
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw error;
    // The protocol reads' own sentence is about the installed writer; this
    // read is the selected image's, so name the image and the read instead.
    throw externalDepError(
      `Could not read the automation writer protocol of the selected image: \`docker image inspect ${reference}\` failed.`,
    );
  }
  const [image] = z
    .array(
      z.object({
        id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        os: imageInspectSchema.shape.Os,
        architecture: imageInspectSchema.shape.Architecture,
        repoDigests: imageInspectSchema.shape.RepoDigests,
        labels: imageInspectSchema.shape.Config.shape.Labels.unwrap(),
      }),
    )
    .length(1)
    .parse(inspected);
  const protocol = imageWriterProtocol(image.labels);
  requireAutomationProtocol(installed, protocol);
  if (protocol === 1) return undefined;
  if (installed === 1 && admission.legacyCutover !== true) {
    // Only a deploy that runs the cutover barrier may start a protocol-2
    // writer beside an existing protocol-1 database. Empty-host installs are
    // safe; rollback has no barrier and never crosses the cutover.
    const databases = await runtime.list({
      stack: getProjectId(),
      service: 'db',
    });
    requireRuntime(
      databases.length === 0,
      'An existing protocol-1 database crosses the automation writer protocol cutover only through `tale deploy` (or managed deployment apply), which runs the cutover barrier; rollback cannot cross it.',
    );
  }
  const repository = `${config.registry}/tale-platform`;
  const digests = [
    ...new Set(
      image.repoDigests.filter(
        (digest) =>
          digest.startsWith(`${repository}@`) &&
          /^sha256:[a-f0-9]{64}$/.test(digest.slice(repository.length + 1)),
      ),
    ),
  ];
  const labels = image.labels;
  requireRuntime(
    image.os === 'linux' &&
      ['amd64', 'arm64'].includes(image.architecture) &&
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
  const runtime = protocolAccess(dependencies);
  const [target] = z
    .array(z.object({ id: z.string().regex(/^sha256:[a-f0-9]{64}$/) }))
    .length(1)
    .parse(await runtime.inspectImage([platformImage]));
  const ids = await runtime.list({ stack: project });
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
        id: z.string(),
        image: z.string(),
        labels: z.record(z.string(), z.string()),
      }),
    )
    .length(ids.length)
    .parse(await runtime.inspect(ids));
  requireRuntime(
    new Set(containers.map((c) => c.id)).size === ids.length &&
      containers.every((c) => ids.includes(c.id)),
    'Pending writer identity changed.',
  );
  for (const service of ['platform', 'backend-api', 'backend-worker']) {
    const matches = containers.filter(
      (c) => c.labels['com.docker.compose.service'] === service,
    );
    requireRuntime(
      matches.length > 0 &&
        matches.every(
          (c) =>
            c.image === target.id &&
            c.labels['com.docker.compose.project'] === project &&
            /^[1-9][0-9]*$/.test(
              c.labels['com.docker.compose.container-number'] ?? '',
            ) &&
            c.labels['com.docker.compose.oneoff']?.toLowerCase() === 'false',
        ),
      'Pending automation writer differs from the admitted image. Use a compatible forward repair.',
    );
  }
}
