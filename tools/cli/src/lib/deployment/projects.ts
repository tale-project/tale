import { z } from 'zod';

import { externalDepError, preconditionError } from '../../utils/fail';
import type { ProvisionContext } from './identity';
import type { DeploymentSpec } from './model';
import { managedProjectSchema } from './model';
import {
  provisionStatePath,
  readProvisionState,
  writeProvisionState,
} from './provision-state';

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\x00-\x20\x7f]+(?![\s\S])/);
const projectSchema = z.object({
  id,
  organizationId: id,
  name: z.string(),
  key: z.string(),
  externalItemId: z.string().nullable(),
  createdBy: id,
  archivedAt: z.unknown().nullable(),
});
type Project = z.infer<typeof projectSchema>;
const intentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  phase: z.enum(['pending', 'ready']),
  organizationId: id,
  operatorUserId: id,
  deployment: z.string(),
  target: managedProjectSchema,
  externalItemId: z.string(),
  projectId: id.optional(),
});
type Target = DeploymentSpec['configs'][number];

/** Resolve all targets before the first write. Native project creation owns its
 * serializable key/external-ID uniqueness checks; the retained intent prevents
 * an uncertain request from becoming a second create on retry. */
export async function resolveDeploymentProjects(
  context: ProvisionContext,
  configs: readonly Target[],
  deployment: string,
  stateDirectory: string,
): Promise<string[]> {
  const base = `/api/app/projects?orgId=${encodeURIComponent(context.organization.id)}`;
  async function list(): Promise<Project[]> {
    const value = z
      .object({ projects: z.array(projectSchema).max(10000) })
      .safeParse(
        await context.requireJson(
          await context.request(`${base}&includeArchived=true`),
          'Native project lookup',
        ),
      );
    if (!value.success)
      throw preconditionError('Invalid native project response.');
    return value.data.projects;
  }
  const before = configs.length ? await list() : [];
  const managed = new Map<
    string,
    {
      target: NonNullable<Target['project']>;
      file: string;
      intent: z.infer<typeof intentSchema> | undefined;
      externalItemId: string;
      found?: Project;
    }
  >();
  for (const config of configs) {
    if (config.projectId) {
      const found = before.filter((project) => project.id === config.projectId);
      if (
        found.length !== 1 ||
        found[0].organizationId !== context.organization.id ||
        found[0].archivedAt !== null
      )
        throw preconditionError(
          'Configured native project does not belong to the verified active organization.',
        );
      continue;
    }
    if (!config.project)
      throw preconditionError('Native project target is missing.');
    const target = managedProjectSchema.parse(config.project);
    const previous = managed.get(target.key);
    if (previous) {
      if (previous.target.name !== target.name)
        throw preconditionError('Managed project key has conflicting names.');
      continue;
    }
    const externalItemId = `tale-deployment:${deployment}:project:${target.key}`;
    const file = provisionStatePath(
      stateDirectory,
      `project-${target.key}.json`,
    );
    const intent = readProvisionState(file, intentSchema);
    if (
      intent &&
      (intent.organizationId !== context.organization.id ||
        intent.operatorUserId !== context.user.id ||
        intent.deployment !== deployment ||
        intent.externalItemId !== externalItemId ||
        JSON.stringify(intent.target) !== JSON.stringify(target))
    )
      throw preconditionError(
        'Native project intent differs from the verified target.',
      );
    const matches = before.filter(
      (project) =>
        project.key === target.key || project.externalItemId === externalItemId,
    );
    const found = matches[0];
    if (
      matches.length > 1 ||
      (found &&
        (!intent ||
          found.organizationId !== context.organization.id ||
          found.key !== target.key ||
          found.name !== target.name ||
          found.externalItemId !== externalItemId ||
          found.createdBy !== context.user.id ||
          found.archivedAt !== null ||
          (intent.projectId && intent.projectId !== found.id)))
    )
      throw preconditionError(
        'Managed native project conflicts with existing identity or intent.',
      );
    if (intent && !found)
      throw preconditionError(
        'Native project creation is uncertain; review its retained intent before retrying.',
      );
    managed.set(target.key, { target, externalItemId, file, intent, found });
  }
  for (const entry of managed.values()) {
    if (!entry.found) {
      const intent = intentSchema.parse({
        schemaVersion: 1,
        phase: 'pending',
        organizationId: context.organization.id,
        operatorUserId: context.user.id,
        deployment,
        target: entry.target,
        externalItemId: entry.externalItemId,
      });
      provisionStatePath(
        stateDirectory,
        `project-${entry.target.key}.json`,
        true,
      );
      writeProvisionState(entry.file, intent, true);
      entry.intent = intent;
      let created: z.infer<typeof id>;
      try {
        const result = z.object({ projectId: id }).parse(
          await context.requireJson(
            await context.request(base, 'POST', {
              ...entry.target,
              externalItemId: entry.externalItemId,
            }),
            'Native project creation',
          ),
        );
        created = result.projectId;
      } catch {
        throw externalDepError(
          'Native project creation did not complete; retained intent requires exact readback before recovery.',
        );
      }
      const after = await list();
      const matches = after.filter(
        (project) =>
          project.key === entry.target.key ||
          project.externalItemId === entry.externalItemId,
      );
      const found = matches[0];
      if (
        matches.length !== 1 ||
        found.id !== created ||
        found.organizationId !== context.organization.id ||
        found.name !== entry.target.name ||
        found.key !== entry.target.key ||
        found.createdBy !== context.user.id ||
        found.externalItemId !== entry.externalItemId ||
        found.archivedAt !== null
      )
        throw preconditionError('Native project creation did not converge.');
      entry.found = found;
    }
    if (entry.intent?.phase === 'pending')
      writeProvisionState(entry.file, {
        ...entry.intent,
        phase: 'ready',
        projectId: entry.found.id,
      });
  }
  const after = configs.length ? await list() : [];
  return configs.map((config) => {
    const projectId =
      config.projectId ??
      (config.project && managed.get(config.project.key)?.found?.id);
    if (!projectId)
      throw preconditionError('Native project resolution did not complete.');
    const matches = after.filter((project) => project.id === projectId);
    const found = matches[0];
    const entry = config.project && managed.get(config.project.key);
    if (
      matches.length !== 1 ||
      found.organizationId !== context.organization.id ||
      found.archivedAt !== null ||
      (entry &&
        (found.key !== entry.target.key ||
          found.name !== entry.target.name ||
          found.externalItemId !== entry.externalItemId ||
          found.createdBy !== context.user.id ||
          after.filter(
            (project) =>
              project.key === entry.target.key ||
              project.externalItemId === entry.externalItemId,
          ).length !== 1))
    )
      throw preconditionError(
        'Native project identity changed during provisioning.',
      );
    return projectId;
  });
}
